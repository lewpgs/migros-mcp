import https from "node:https";
import axios from "axios";
import type { AxiosInstance, AxiosResponse } from "axios";
import type { Session } from "./cookies.js";
import { cookieHeader, ingestSetCookie } from "./cookies.js";

// IMPORTANT: per-host User-Agent. Akamai on www.migros.ch rejects Chrome but
// accepts this Firefox/Linux UA (same approach as migros-api-wrapper). The login
// origin uses Cloudflare which is more permissive and accepts Chrome.
const UA_LOGIN = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
const UA_WWW = "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";

const REDIRECT_URI = "https://www.migros.ch/m-login-silent-login-redirect.html";

let _client: AxiosInstance | null = null;
export function client(): AxiosInstance {
  // Lazily build to avoid creating an https.Agent at module-load time.
  if (_client) return _client;
  _client = axios.create({
    httpsAgent: new https.Agent({ minVersion: "TLSv1.3" }),
    validateStatus: () => true,
    maxRedirects: 0,
  });
  return _client;
}

export function uaFor(host: string): string {
  return host === "www.migros.ch" ? UA_WWW : UA_LOGIN;
}

export function uniformHeaders(host: string, session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": uaFor(host),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Cookie: cookieHeader(session, host),
    ...extra,
  };
}

function decodeJwtExp(jwt: string): number {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64").toString()) as { exp?: number };
  if (typeof payload.exp !== "number") throw new Error("JWT has no exp claim");
  return payload.exp;
}

/**
 * Run the silent OAuth flow against current SSO cookies and return a fresh
 * access token. Mutates `session` in place (cookies + jwt + jwtExp).
 *
 * Throws if the SSO cookies are missing/expired (e.g., user logged out of
 * migros.ch in their browser, or session.json is stale by weeks).
 *
 * Caller is responsible for persisting the session afterward.
 */
export async function silentOAuth(session: Session): Promise<string> {
  // Step 1: ask www.migros.ch for the silent-SSO URL on login.migros.ch.
  const authorizeUrl =
    "https://www.migros.ch/authentication/public/v1/api/oauth/authorize" +
    "?redirectUri=" + encodeURIComponent(REDIRECT_URI) +
    "&withLoginPrompt=false&claimType=LOGIN&authorizationNotRequired=true";
  let r: AxiosResponse = await client().get(authorizeUrl, {
    headers: uniformHeaders("www.migros.ch", session, { Accept: "application/json, text/plain, */*" }),
  });
  ingestSetCookie(session, "www.migros.ch", r.headers["set-cookie"]);
  if (r.status !== 200) throw new Error(`oauth/authorize -> ${r.status}`);
  const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  const ssoUrl: string | undefined = data?.url;
  if (!ssoUrl) throw new Error("oauth/authorize did not return a sso url");

  // Step 2: hit login.migros.ch with our SSO cookies. With prompt=none, valid
  // cookies redirect with ?code=...&state=...; expired cookies return an error.
  r = await client().get(ssoUrl, {
    headers: uniformHeaders("login.migros.ch", session, { Accept: "text/html" }),
  });
  ingestSetCookie(session, "login.migros.ch", r.headers["set-cookie"]);
  const location: string | undefined = r.headers.location;
  if (!location) {
    throw new Error("silent SSO did not redirect — login.migros.ch session likely expired");
  }
  const u = new URL(location);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state");
  if (!code || !state) throw new Error("silent SSO redirected without code/state");

  // Step 3: exchange the code for a JWT.
  const successUrl =
    "https://www.migros.ch/authentication/public/v1/api/oauth/login-success" +
    `?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` +
    "&redirectUri=" + encodeURIComponent(REDIRECT_URI) +
    "&authorizationNotRequired=true";
  r = await client().get(successUrl, {
    headers: uniformHeaders("www.migros.ch", session, { Accept: "application/json" }),
  });
  ingestSetCookie(session, "www.migros.ch", r.headers["set-cookie"]);
  if (r.status !== 200) throw new Error(`oauth/login-success -> ${r.status}`);
  const tokenBody = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown>;
  let token = (tokenBody.accessToken ?? tokenBody.access_token ?? tokenBody.token ?? null) as string | null;
  if (!token) throw new Error("oauth/login-success did not return a token");

  // Migros returns the token with a literal "Bearer " prefix in the JSON body.
  // Strip so callers can safely set `Authorization: Bearer ${token}`.
  if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, "");

  session.jwt = token;
  session.jwtExp = decodeJwtExp(token);
  return token;
}

/**
 * Returns a usable JWT, refreshing via silent OAuth if the cached one is
 * within `bufferSeconds` of expiring (or missing). Mutates `session`.
 */
export async function getJwt(session: Session, bufferSeconds = 60): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (session.jwt && session.jwtExp && session.jwtExp - now > bufferSeconds) {
    return session.jwt;
  }
  return silentOAuth(session);
}
