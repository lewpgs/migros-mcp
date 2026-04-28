import type { AxiosResponse } from "axios";
import { client, uniformHeaders } from "./oauth.js";
import { ingestSetCookie, loadSession, saveSession, type Session } from "./cookies.js";
import { getJwt } from "./index.js";
import type { Credentials } from "./login.js";

const BASE = "https://www.migros.ch";

export interface AuthOptions {
  /** Credentials used only when no cached session exists. */
  creds?: Credentials;
  /** Override the user's locale for migros-language / accept-language headers. */
  language?: string;
}

/**
 * Make an authenticated request against any www.migros.ch path. Reuses the
 * persisted session, refreshes the JWT silently when needed, and falls back
 * to a full credentialed login if cookies have expired.
 *
 * Returns the parsed response body. Throws with a descriptive error on non-2xx.
 */
export async function api(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  opts: AuthOptions = {}
): Promise<unknown> {
  const session: Session = loadSession();
  const jwt = await getJwt(opts.creds);
  // getJwt() may have mutated session via silentOAuth; reload it so we have
  // fresh cookies for this request, then write back any new cookies after.
  const fresh = loadSession();

  const language = opts.language ?? "en";
  const headers = uniformHeaders("www.migros.ch", fresh, {
    Accept: "application/json, text/plain, */*",
    Authorization: `Bearer ${jwt}`,
    "migros-language": language,
    "accept-language": language,
    "peer-id": "website-js-1143.0.0",
    Origin: BASE,
    Referer: `${BASE}/en`,
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  });

  const r: AxiosResponse = await client().request({
    method,
    url: `${BASE}${path}`,
    data: body,
    headers,
  });
  ingestSetCookie(fresh, "www.migros.ch", r.headers["set-cookie"]);
  saveSession(fresh);

  if (r.status < 200 || r.status >= 300) {
    const snippet = typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
    throw new Error(`${method} ${path} -> ${r.status}: ${snippet}`);
  }
  return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
}
