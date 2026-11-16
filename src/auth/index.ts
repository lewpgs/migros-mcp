import { loadSession, saveSession, type Session } from "./cookies.js";
import { getJwt as getJwtFromOauth, silentOAuth, JWT_BUFFER_SECONDS } from "./oauth.js";
import { fullLogin, FreshCodeRequiredError, type Credentials } from "./login.js";
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
export interface GetJwtOptions {
  /**
   * Try a full login even when the account is known to need a 2FA code and no
   * seed or code was given. Set by the `authenticate` tool, so an account that
   * has since turned 2FA off can still log in.
   */
  tryLoginWithoutCode?: boolean;
}

/**
 * Runs logins one at a time. Without this, tool calls that arrive together
 * (clients often send several at once) would each start their own login:
 * Migros sees repeated half-finished logins and blocks the IP, and each login
 * overwrites the cookies the other one saved. The second caller waits, then
 * finds the fresh token in the saved session and doesn't log in again.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * After a full login failed (wrong password, a bot check, a changed login
 * page), every tool call would otherwise try again at once: ten calls, ten
 * half-finished logins in a few seconds, which is what gets an IP blocked.
 * So wait this long before the next try. Calling authenticate with a fresh
 * 2FA code tries again right away (the user asked for it).
 */
export const LOGIN_BACKOFF_MS = 60_000;
let failedLogin: { until: number; reason: string; needsCode?: boolean } | null = null;

/** For tests only. */
export function resetLoginBackoff(): void {
  failedLogin = null;
}

/** A refresh was needed, but login.migros.ch is in a rate-limit cooldown. */
export class CooldownError extends Error {}

export function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function getJwt(creds?: Credentials, opts: GetJwtOptions = {}): Promise<string> {
  return serialized(() => getJwtNow(creds, opts));
}

/**
 * A fresh token after Migros rejected `rejected` with a 401. If another call
 * already replaced it meanwhile, that one is used instead of refreshing again.
 */
export function refreshJwt(rejected: string): Promise<string> {
  return serialized(async () => {
    const session = loadSession();
    if (session.jwt && session.jwt !== rejected) return session.jwt;
    if (isRateLimited(session)) {
      const until = session.rateLimitedUntil ? new Date(session.rateLimitedUntil).toISOString() : "unknown time";
      throw new CooldownError(`token rejected, but login.migros.ch is rate-limited until ${until} — cannot refresh`);
    }
    try {
      const jwt = await silentOAuth(session);
      saveSession(session);
      return jwt;
    } catch (e) {
      // Save the cooldown silentOAuth just set, so the next call doesn't retry.
      if (e instanceof RateLimitError) saveSession(session);
      throw e;
    }
  });
}

async function getJwtNow(creds: Credentials | undefined, opts: GetJwtOptions): Promise<string> {
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
      // The throwing call already set the cooldown. Only set it here if it didn't,
      // so one 429 isn't counted twice by the backoff.
      if (!isRateLimited(session)) setRateLimited(session, e.retryAfterSeconds, e.message);
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
          "Set MIGROS_EMAIL and MIGROS_PASSWORD to enable login. If the account has 2FA, also set " +
          "MIGROS_TOTP_SECRET, or call authenticate with the current six-digit code."
      );
    }
  }

  // Don't start a login that can't finish: if the last login needed a 2FA code
  // and there is neither a stored seed nor a code, ask for the code before
  // sending the password to Migros. Repeated half-logins get the IP blocked.
  if (session.twoFactorRequired && !creds.totpSecret && !creds.totpCode && !opts.tryLoginWithoutCode) {
    throw new FreshCodeRequiredError();
  }

  // --- Path 3: full credentialed login ---
  if (failedLogin && Date.now() < failedLogin.until && !creds.totpCode) {
    // The last try stopped at the 2FA step: only a code helps, so say that.
    if (failedLogin.needsCode && !creds.totpSecret) throw new FreshCodeRequiredError();
    const wait = Math.ceil((failedLogin.until - Date.now()) / 1000);
    throw new Error(
      `the last Migros login failed (${failedLogin.reason}). Not trying again for ${wait} s, ` +
        "so Migros doesn't block this computer."
    );
  }
  try {
    const jwt = await fullLogin(session, creds);
    failedLogin = null;
    // Successful login clears any stale cooldown.
    clearRateLimit(session);
    saveSession(session);
    return jwt;
  } catch (e) {
    // If fullLogin hits a 429, persist the cooldown so the next call doesn't
    // immediately retry.
    if (e instanceof RateLimitError) {
      // The throwing call already set the cooldown. Only set it here if it didn't,
      // so one 429 isn't counted twice by the backoff.
      if (!isRateLimited(session)) setRateLimited(session, e.retryAfterSeconds, e.message);
      saveSession(session);
    }
    if (!(e instanceof RateLimitError) && !(e instanceof FreshCodeRequiredError)) {
      failedLogin = { until: Date.now() + LOGIN_BACKOFF_MS, reason: (e as Error).message };
    }
    if (e instanceof FreshCodeRequiredError && !creds.totpCode) {
      // authenticate without a code sent the password and stopped at the 2FA
      // step. Calling it again the same way would do the same: wait, unless
      // a code comes.
      failedLogin = { until: Date.now() + LOGIN_BACKOFF_MS, reason: "a 2FA code is needed", needsCode: true };
    }
    if (e instanceof FreshCodeRequiredError) {
      // Remember that this account needs a code. Start from the saved session
      // so the half-finished login's cookies aren't kept.
      const saved = loadSession();
      saved.twoFactorRequired = true;
      saveSession(saved);
    }
    throw e;
  }
}
