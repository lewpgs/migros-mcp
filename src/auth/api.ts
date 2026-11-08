import type { AxiosResponse } from "axios";
import { client, silentOAuth, uniformHeaders } from "./oauth.js";
import { ingestSetCookie, loadSession, saveSession, type Session } from "./cookies.js";
import { getJwt } from "./index.js";
import { isRateLimited, RateLimitError } from "./rate-limit.js";
import type { Credentials } from "./login.js";

const BASE = "https://www.migros.ch";

export interface AuthOptions {
  /** Credentials used only when no cached session exists. */
  creds?: Credentials;
  /** Override the user's locale for migros-language / accept-language headers. */
  language?: string;
}

async function makeRequest(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  jwt: string,
  language: string,
  session: Session
): Promise<AxiosResponse> {
  const headers = uniformHeaders("www.migros.ch", session, {
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${jwt}`,
    "migros-language": language,
    "accept-language": language,
    "peer-id": "website-js-1143.0.0",
    Origin: BASE,
    Referer: `${BASE}/en`,
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  });
  return client().request({
    method,
    url: `${BASE}${path}`,
    data: body,
    headers,
  });
}

/**
 * Make an authenticated request against any www.migros.ch path. Reuses the
 * persisted session, refreshes the JWT silently when needed, and falls back
 * to a full credentialed login if cookies have expired.
 *
 * On 401 (token rejected mid-request — e.g., user changed their password,
 * or the server invalidated the token early for any reason), forces a fresh
 * silent OAuth and retries once before giving up.
 *
 * Returns the parsed response body. Throws with a descriptive error on non-2xx.
 */
export async function api(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: AuthOptions = {}
): Promise<unknown> {
  const language = opts.language ?? "en";

  // First attempt with current cached / refreshed JWT.
  let jwt = await getJwt(opts.creds);
  let session = loadSession();
  let r = await makeRequest(method, path, body, jwt, language, session);
  ingestSetCookie(session, "www.migros.ch", r.headers["set-cookie"]);
  saveSession(session);

  // Token rejected? Force a silent refresh and retry once.
  if (r.status === 401) {
    session = loadSession();
    // Never hammer the rate-limited host: if a cooldown is active, skip the
    // refresh entirely and surface a clear error instead of firing another
    // login-host request (which would 429 and extend the throttle).
    if (isRateLimited(session)) {
      const until = session.rateLimitedUntil
        ? new Date(session.rateLimitedUntil).toISOString()
        : "unknown time";
      throw new Error(
        `${method} ${path} -> 401 (token rejected, but login.migros.ch is rate-limited until ${until} — cannot refresh)`
      );
    }
    try {
      jwt = await silentOAuth(session);
      saveSession(session);
      r = await makeRequest(method, path, body, jwt, language, session);
      ingestSetCookie(session, "www.migros.ch", r.headers["set-cookie"]);
      saveSession(session);
    } catch (e) {
      // Rate-limit errors should always surface — swallowing them hides the
      // cooldown from the caller and defeats the cascade-prevention logic.
      if (e instanceof RateLimitError) throw e;
      // Silent refresh failed (cookies actually expired). Surface the original
      // 401 since that's more actionable than the silent-refresh error.
    }
  }

  if (r.status < 200 || r.status >= 300) {
    const snippet = typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
    throw new Error(`${method} ${path} -> ${r.status}: ${snippet}`);
  }
  return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
}
