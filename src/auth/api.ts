import type { AxiosResponse } from "axios";
import { client, uniformHeaders } from "./oauth.js";
import { ingestSetCookie, loadSession, saveSession, type Session } from "./cookies.js";
import { CooldownError, getJwt, refreshJwt } from "./index.js";
import { RateLimitError } from "./rate-limit.js";
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
 * Store the cookies a response set. Reads the saved session afresh and writes
 * it back in one synchronous step, so a login that finished while this
 * request was out isn't overwritten with the older copy.
 */
function keepCookies(r: AxiosResponse): void {
  if (!r.headers["set-cookie"]) return;
  const session = loadSession();
  ingestSetCookie(session, "www.migros.ch", r.headers["set-cookie"]);
  saveSession(session);
}

/**
 * Make an authenticated request against any www.migros.ch path. Reuses the
 * persisted session, refreshes the JWT silently when needed, and falls back
 * to a full credentialed login if cookies have expired.
 *
 * On 401 (token rejected mid-request — e.g., user changed their password,
 * or the server invalidated the token early for any reason), gets a fresh
 * token by silent OAuth (or the one another call just got) and retries once.
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
  let r = await makeRequest(method, path, body, jwt, language, loadSession());
  keepCookies(r);

  // Token rejected? Get a fresh one (or the one another call just got) and retry once.
  if (r.status === 401) {
    try {
      jwt = await refreshJwt(jwt);
    } catch (e) {
      // Rate-limit errors should always surface — swallowing them hides the
      // cooldown from the caller and defeats the cascade-prevention logic.
      if (e instanceof RateLimitError) throw e;
      if (e instanceof CooldownError) throw new Error(`${method} ${path} -> 401 (${e.message})`);
      // Silent refresh failed (cookies actually expired). Surface the original
      // 401 since that's more actionable than the silent-refresh error.
      jwt = "";
    }
    if (jwt) {
      r = await makeRequest(method, path, body, jwt, language, loadSession());
      keepCookies(r);
    }
  }

  if (r.status < 200 || r.status >= 300) {
    const snippet = typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
    throw new Error(`${method} ${path} -> ${r.status}: ${snippet}`);
  }
  return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
}
