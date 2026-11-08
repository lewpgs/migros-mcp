import crypto from "node:crypto";
import type { AxiosResponse } from "axios";
import type { Session } from "./cookies.js";
import { ingestSetCookie } from "./cookies.js";
import { client, uniformHeaders, silentOAuth } from "./oauth.js";
import { parseRetryAfter, RateLimitError, setRateLimited } from "./rate-limit.js";

export interface Credentials {
  email: string;
  password: string;
  /**
   * Base32-encoded TOTP seed (MIGROS_TOTP_SECRET). When set, the MCP makes the
   * 2FA code itself and re-logins need no help.
   */
  totpSecret?: string;
  /**
   * Current six-digit TOTP code passed to the `authenticate` tool. The option
   * for people who don't want to store the seed. Used before the seed if both
   * are present.
   */
  totpCode?: string;
}

const LOGIN = "https://login.migros.ch";

export class FreshCodeRequiredError extends Error {
  constructor(
    message = "fresh_code_required: this Migros account needs a 2FA code. Ask the user for the current " +
      "six-digit code from their authenticator app and call the authenticate tool with it."
  ) {
    super(message);
    this.name = "FreshCodeRequiredError";
  }
}

/**
 * RFC 6238 TOTP code from a base32-encoded shared secret.
 * Defaults match Google Authenticator / 1Password / Authy: SHA-1, 30s, 6 digits.
 */
export function totpFromSecret(
  secretBase32: string,
  time: number = Math.floor(Date.now() / 1000),
  step = 30,
  digits = 6
): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secretBase32.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const c of cleaned) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error(`invalid base32 char in TOTP secret: ${c}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i++) {
    key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / step)));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const slice = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(slice % 10 ** digits).padStart(digits, "0");
}

/**
 * The code to submit at the 2FA step: the one passed to `authenticate` if
 * there is one, else one made from the stored seed. Throws
 * FreshCodeRequiredError when there is neither.
 */
export function otpCodeFor(creds: Credentials, time?: number): string {
  if (creds.totpCode) {
    if (!/^\d{6}$/.test(creds.totpCode)) throw new Error("totpCode must be exactly six digits");
    return creds.totpCode;
  }
  if (creds.totpSecret) return totpFromSecret(creds.totpSecret, time);
  throw new FreshCodeRequiredError();
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
  // Remembered in the session so a later login without seed or code can stop
  // before sending the password (see getJwt).
  session.twoFactorRequired = needsOtp;
  if (needsOtp) {
    const code = otpCodeFor(creds);
    r = await get(nextUrl, session);
    csrf = findCsrf(r.data as string);
    const otpAction = (r.data as string).match(/<form[^>]+action="([^"]*)"/)?.[1] || nextUrl;
    const otpUrl = new URL(otpAction, nextUrl).toString();
    r = await postForm(otpUrl, session, { _csrf: csrf, code });
    nextUrl = locationOf(r, LOGIN);
    if (!nextUrl) {
      const why = findError(r.data as string) ?? `status ${r.status}`;
      if (creds.totpCode) {
        // A code typed in or read from a password manager may simply have
        // expired: ask for a new one, and keep the real reason in the message.
        throw new FreshCodeRequiredError(
          `fresh_code_required: Migros did not accept the code (${why}). Get a new code and call authenticate once more.`
        );
      }
      throw new Error(`OTP step failed: ${why}`);
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
