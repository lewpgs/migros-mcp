import { loadSession, saveSession, type Session } from "./cookies.js";
import { getJwt as getJwtFromOauth, silentOAuth, JWT_BUFFER_SECONDS } from "./oauth.js";
import { fullLogin, type Credentials } from "./login.js";
import {
  isRateLimited,
  RateLimitError,
  setRateLimited,
  clearRateLimit,
  rateLimitBlockedMessage,
} from "./rate-limit.js";

export type { Session, Credentials };
export { silentOAuth, fullLogin };

/**
 * Returns a usable access token, doing whatever is needed:
 *   1. Use the cached JWT if it's still valid (with a 5 min buffer).
 *   2. Else run silent OAuth using cached SSO cookies.
 *   3. Else fall back to a full credentialed login (email → password → TOTP).
 *
 * **Rate-limit handling (429 Too Many Requests):**
 *
 * - If the session carries an active rate-limit cooldown (`rateLimitedUntil` in
 *   the future), we **never** attempt silent OAuth or full login. Instead we
 *   fail‑open when the cached JWT is still valid or throw a clear error.
 * - A 429 from silent OAuth is **not** cascaded into full login because they
 *   share the same host (`login.migros.ch`) and the same Cloudflare throttle.
 * - After a successful refresh the cooldown is cleared automatically.
 *
 * Persists the session to disk after any refresh so subsequent calls are fast.
 *
 * Throws if `creds` is missing AND no cookies are cached (first-time install
 * with no env vars set).
 */
export async function getJwt(creds?: Credentials): Promise<string> {
  const session: Session = loadSession();

  // --- Rate-limit cooldown guard ---
  if (isRateLimited(session)) {
    // Fail‑open: if the cached JWT is still valid we return it regardless of
    // the throttle — a working session must never be blocked by the login rate
    // limiter. Apply the same buffer as the refresh path so we never hand a
    // near-expired token to the API (it would 401 and trigger a rate-limited
    // refresh attempt).
    const now = Math.floor(Date.now() / 1000);
    if (session.jwt && session.jwtExp && session.jwtExp - now > JWT_BUFFER_SECONDS) {
      return session.jwt;
    }
    // JWT expired + rate‑limited → hard fail with an actionable message.
    throw new Error(rateLimitBlockedMessage(session));
  }

  // --- Path 1+2: try cached JWT, fall through to silent OAuth ---
  try {
    const jwt = await getJwtFromOauth(session);
    // Successful refresh clears any stale cooldown.
    clearRateLimit(session);
    saveSession(session);
    return jwt;
  } catch (e) {
    if (e instanceof RateLimitError) {
      // 429 from silent OAuth → apply cooldown, persist, and do NOT cascade.
      setRateLimited(session, e.retryAfterSeconds, e.message);
      saveSession(session);

      // Fail‑open: if the current (possibly stale) JWT is still valid we
      // return it rather than failing the tool call entirely. Apply the same
      // buffer as the refresh path (see above).
      const now = Math.floor(Date.now() / 1000);
      if (session.jwt && session.jwtExp && session.jwtExp - now > JWT_BUFFER_SECONDS) {
        return session.jwt;
      }
      // No usable JWT — surface the rate-limit error.
      throw e;
    }

    // Not a rate-limit error — silent OAuth failed because cookies are
    // missing/expired. Fall through to a full credentialed login.
    if (!creds) {
      throw new Error(
        "no cached session and no credentials provided. " +
          "Set MIGROS_EMAIL, MIGROS_PASSWORD, and MIGROS_TOTP_SECRET env vars to enable login."
      );
    }
  }

  // --- Path 3: full credentialed login ---
  try {
    const jwt = await fullLogin(session, creds);
    // Successful login clears any stale cooldown.
    clearRateLimit(session);
    saveSession(session);
    return jwt;
  } catch (e) {
    // If fullLogin hits a 429, persist the cooldown so the next call doesn't
    // immediately retry.
    if (e instanceof RateLimitError) {
      setRateLimited(session, e.retryAfterSeconds, e.message);
      saveSession(session);
    }
    throw e;
  }
}
