import { loadSession, saveSession, type Session } from "./cookies.js";
import { getJwt as getJwtFromOauth, silentOAuth } from "./oauth.js";
import { fullLogin, type Credentials } from "./login.js";

export type { Session, Credentials };
export { silentOAuth, fullLogin };

/**
 * Returns a usable access token, doing whatever is needed:
 *   1. Use the cached JWT if it's still valid (with a 60s buffer).
 *   2. Else run silent OAuth using cached SSO cookies.
 *   3. Else fall back to a full credentialed login (email -> password -> TOTP).
 *
 * Persists the session to disk after any refresh so subsequent calls are fast.
 *
 * Throws if `creds` is missing AND no cookies are cached (first-time install
 * with no env vars set).
 */
export async function getJwt(creds?: Credentials): Promise<string> {
  const session: Session = loadSession();

  // Path 1+2: try cached JWT, fall through to silent OAuth.
  try {
    const jwt = await getJwtFromOauth(session);
    saveSession(session);
    return jwt;
  } catch (e) {
    // Silent OAuth failed (no cookies / expired cookies). Fall through.
    if (!creds) {
      throw new Error(
        "no cached session and no credentials provided. " +
          "Set MIGROS_EMAIL, MIGROS_PASSWORD, and MIGROS_TOTP_SECRET env vars to enable login."
      );
    }
  }

  // Path 3: full credentialed login.
  const jwt = await fullLogin(session, creds);
  saveSession(session);
  return jwt;
}
