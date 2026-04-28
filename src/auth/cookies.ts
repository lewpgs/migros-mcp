import fs from "node:fs";
import path from "node:path";
import { configDir, sessionFile } from "./paths.js";

/**
 * Persisted auth state. Lives in the OS config dir, not in the project tree.
 *
 * - `cookies` is keyed by host so we can send the right Cookie header per request.
 * - `jwt` is the access token from /authentication/.../oauth/login-success (Bearer
 *   prefix already stripped by the caller).
 * - `jwtExp` is the JWT's `exp` claim in unix seconds, used to decide when to
 *   refresh proactively without parsing the token on every call.
 */
export interface Session {
  cookies: Record<string, Record<string, string>>;
  jwt: string | null;
  jwtExp: number; // unix seconds; 0 means "no JWT cached"
}

const EMPTY: Session = { cookies: {}, jwt: null, jwtExp: 0 };

/** Read the persisted session, or return an empty one if no file exists. */
export function loadSession(): Session {
  try {
    const raw = fs.readFileSync(sessionFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Session>;
    return {
      cookies: parsed.cookies ?? {},
      jwt: parsed.jwt ?? null,
      jwtExp: parsed.jwtExp ?? 0,
    };
  } catch (err) {
    // Missing file (ENOENT) or unreadable: treat as empty.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY, cookies: {} };
    // Corrupted JSON: don't throw and crash the MCP — start fresh and let the user re-import.
    return { ...EMPTY, cookies: {} };
  }
}

/** Write the session atomically (temp file + rename) to avoid partial writes. */
export function saveSession(session: Session): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = sessionFile();
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, finalPath);
}

/**
 * Update the jar from a server's Set-Cookie response headers for a given host.
 * Mutates `session.cookies[host]` in place. Caller decides when to persist.
 */
export function ingestSetCookie(
  session: Session,
  host: string,
  setCookies: string | string[] | undefined
): void {
  if (!setCookies) return;
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  const bag = (session.cookies[host] ??= {});
  for (const sc of list) {
    // Take only the "name=value" pair before the first semicolon. Attributes
    // like Path, Domain, HttpOnly, etc. are intentionally discarded — we don't
    // re-issue cookies, we just send what we got back to the same host.
    const semi = sc.indexOf(";");
    const pair = semi === -1 ? sc : sc.slice(0, semi);
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    bag[name] = value;
  }
}

/** Build the `Cookie:` request header for a host (empty string if no cookies). */
export function cookieHeader(session: Session, host: string): string {
  const bag = session.cookies[host];
  if (!bag) return "";
  return Object.entries(bag)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
