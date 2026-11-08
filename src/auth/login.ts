import type { AxiosResponse } from "axios";
import type { Session } from "./cookies.js";
import { ingestSetCookie } from "./cookies.js";
import { client, uniformHeaders, silentOAuth } from "./oauth.js";
import { parseRetryAfter, RateLimitError, setRateLimited } from "./rate-limit.js";

export interface Credentials {
  email: string;
  password: string;
  /** Current six-digit TOTP code. Required only when the server asks for 2FA. */
  totpCode?: string;
}

const LOGIN = "https://login.migros.ch";

export class FreshCodeRequiredError extends Error {
  constructor(message = "fresh_code_required: provide a current six-digit TOTP code") {
    super(message);
    this.name = "FreshCodeRequiredError";
  }
}

function findCsrf(html: string): string {
  const m = html.match(/name="_csrf"[^>]*value="([^"]+)"/);
  if (!m) throw new Error("could not find CSRF token in form");
  return m[1];
}

function findError(html: string): string | null {
  // The Migros login form renders errors in a div with class "info-message-error".
  const m = html.match(/info-message-error[^>]*>[\s\S]*?<div[^>]*>([\s\S]{0,200})</);
  return m ? m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : null;
}

async function get(url: string, session: Session, extra: Record<string, string> = {}) {
  const host = new URL(url).host;
  const r = await client().get(url, { headers: uniformHeaders(host, session, { Accept: "text/html", ...extra }) });
  ingestSetCookie(session, host, r.headers["set-cookie"]);
  if (r.status === 429) {
    const retryAfter = parseRetryAfter(r.headers["retry-after"] as string | undefined);
    setRateLimited(session, retryAfter, "login " + url + " -> 429");
    throw new RateLimitError(
      "login.migros.ch rate-limited (429) during GET " + url + ". " +
        "Retry after: " + (retryAfter ?? "unknown") + "s",
      retryAfter,
    );
  }
  return r;
}

async function postForm(url: string, session: Session, body: Record<string, string>) {
  const host = new URL(url).host;
  const formBody = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const r = await client().post(url, formBody, {
    headers: uniformHeaders(host, session, {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: `https://${host}`,
      Referer: url,
    }),
  });
  ingestSetCookie(session, host, r.headers["set-cookie"]);
  if (r.status === 429) {
    const retryAfter = parseRetryAfter(r.headers["retry-after"] as string | undefined);
    setRateLimited(session, retryAfter, "login POST " + url + " -> 429");
    throw new RateLimitError(
      "login.migros.ch rate-limited (429) during POST " + url + ". " +
        "Retry after: " + (retryAfter ?? "unknown") + "s",
      retryAfter,
    );
  }
  return r;
}

function locationOf(r: AxiosResponse, base: string): string | null {
  const loc = r.headers.location as string | undefined;
  return loc ? new URL(loc, base).toString() : null;
}

/**
 * Run the full credentialed login (email → password → TOTP) and finish by
 * minting a JWT via silent OAuth. Mutates `session` in place. Caller persists.
 *
 * Throws with a descriptive message if any step fails (bad password, server-
 * imposed rate limit, Cloudflare challenge, etc.).
 */
export async function fullLogin(session: Session, creds: Credentials): Promise<string> {
  // 1. Land on /login/email and capture initial cookies + CSRF.
  let r = await get(`${LOGIN}/login`, session);
  if (r.status >= 300 && r.status < 400) {
    const next = locationOf(r, LOGIN);
    if (next) r = await get(next, session);
  }
  let csrf = findCsrf(r.data as string);

  // 2. POST email.
  r = await postForm(`${LOGIN}/login/email`, session, {
    _csrf: csrf,
    authenticationPayload: "",
    email: creds.email,
  });
  let nextUrl = locationOf(r, LOGIN);
  if (!nextUrl) {
    throw new Error(`email step failed: ${findError(r.data as string) ?? `status ${r.status}`}`);
  }

  // 3. Server may steer to /login/passkey if the account has one. Force password.
  if (nextUrl.includes("/login/passkey")) nextUrl = `${LOGIN}/login/password`;

  // 4. GET password page → capture new CSRF + form action.
  r = await get(nextUrl, session);
  csrf = findCsrf(r.data as string);
  const passwordAction = (r.data as string).match(/<form[^>]+action="([^"]*)"/)?.[1] || nextUrl;
  const passwordUrl = new URL(passwordAction, nextUrl).toString();

  // 5. POST password.
  r = await postForm(passwordUrl, session, { _csrf: csrf, password: creds.password });
  nextUrl = locationOf(r, LOGIN);
  if (!nextUrl) {
    throw new Error(`password step failed: ${findError(r.data as string) ?? `status ${r.status}`}`);
  }

  // 6. Server may steer to /login/passkey for the second factor too. Force authenticator.
  if (nextUrl.includes("/login/passkey")) nextUrl = `${LOGIN}/login/authenticator`;

  // 7. If a 2FA step is in the chain, handle it. Otherwise skip.
  const needsOtp = /\/login\/(authenticator|second|totp|otp)/.test(nextUrl);
  if (needsOtp) {
    if (!creds.totpCode) throw new FreshCodeRequiredError();
    if (!/^\d{6}$/.test(creds.totpCode)) {
      throw new Error("totpCode must be exactly six digits");
    }
    r = await get(nextUrl, session);
    csrf = findCsrf(r.data as string);
    const otpAction = (r.data as string).match(/<form[^>]+action="([^"]*)"/)?.[1] || nextUrl;
    const otpUrl = new URL(otpAction, nextUrl).toString();
    r = await postForm(otpUrl, session, { _csrf: csrf, code: creds.totpCode });
    nextUrl = locationOf(r, LOGIN);
    if (!nextUrl) {
      throw new FreshCodeRequiredError("fresh_code_required: Migros rejected the TOTP code; retrieve a new code and retry once");
    }
  }

  // 8. Follow the post-login redirect chain to settle SSO state.
  let hops = 0;
  while (nextUrl && hops < 10) {
    r = await get(nextUrl, session, { Accept: "text/html,application/json" });
    const loc = locationOf(r, nextUrl);
    if (!loc) break;
    nextUrl = loc;
    hops++;
  }

  // 9. Mint the JWT via silent OAuth using the cookies we just collected.
  return silentOAuth(session);
}
