/**
 * 429 Too Many Requests handling for login.migros.ch.
 *
 * Cloudflare sits in front of login.migros.ch and throttles repeated login
 * attempts. Without this module every authenticated tool call cascades from
 * silent-OAuth failure straight into a full credentialed login that hammers the
 * same rate-limited host, making the throttle worse and keeping the MCP
 * unusable for the user.
 *
 * All times are in **unix epoch milliseconds** (Date.now() convention) to keep
 * exported constants unambiguous.
 */

/**
 * Parse a `Retry-After` response header into a **seconds** value.
 *
 * Returns `null` when the header is missing, unparseable, or describes a date
 * in the past (negative delay).
 */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) return null;
  const v = header.trim();

  // Integer → delay-seconds.
  if (/^\d+$/.test(v)) {
    const s = Number.parseInt(v, 10);
    return Number.isFinite(s) && s >= 0 ? s : null;
  }

  // HTTP-date (RFC 7231) — heuristically detect via the presence of letters
  // or commas; Date.parse is very lenient and would accept "-1" as a valid
  // (negative) timestamp, giving a false positive.
  if (/[a-z,]/i.test(v)) {
    const epoch = Date.parse(v);
    if (!Number.isNaN(epoch)) {
      const sec = Math.ceil((epoch - Date.now()) / 1000);
      // Negative means the date is in the past: clamp to 0 (retry immediately).
      return Math.max(0, sec);
    }
  }

  return null;
}

/**
 * Exponential backoff schedule for when Retry-After is missing.
 *
 * Returns **milliseconds**.
 */
export function rateLimitBackoff(attempt: number): number {
  const delays = [30_000, 120_000, 600_000]; // 30 s → 2 min → 10 min
  return delays[Math.min(attempt, delays.length - 1)] ?? 600_000;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Thrown by the auth layer when a 429 is detected so upper layers can
 * distinguish "we're being throttled" from "your credentials are wrong".
 */
export class RateLimitError extends Error {
  /** Parsed Retry-After in **seconds**, or `null` when the header was absent. */
  public readonly retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ---------------------------------------------------------------------------
// Cooldown state helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the session carries a rate-limit cooldown that hasn't
 * expired yet.
 */
export function isRateLimited(session: { rateLimitedUntil?: number }): boolean {
  return typeof session.rateLimitedUntil === "number" && Date.now() < session.rateLimitedUntil;
}

/**
 * Apply a cooldown timestamp to the session in-place (caller persists).
 *
 * @param retryAfterSeconds  Parsed Retry-After seconds, or `null` to fall
 *                           back to the first backoff step (30 s).
 */
export function setRateLimited(
  session: { rateLimitedUntil?: number; rateLimitReason?: string },
  retryAfterSeconds: number | null,
  reason: string,
): void {
  const delay = retryAfterSeconds !== null ? retryAfterSeconds * 1000 : rateLimitBackoff(0);
  session.rateLimitedUntil = Date.now() + delay;
  session.rateLimitReason = reason;
}

/** Remove any rate-limit cooldown from the session. */
export function clearRateLimit(session: { rateLimitedUntil?: number; rateLimitReason?: string }): void {
  delete session.rateLimitedUntil;
  delete session.rateLimitReason;
}

/** Build a human-readable error for `isRateLimited` + expired JWT. */
export function rateLimitBlockedMessage(session: {
  rateLimitedUntil?: number;
  rateLimitReason?: string;
}): string {
  const until = session.rateLimitedUntil
    ? new Date(session.rateLimitedUntil).toISOString()
    : "unknown";
  return (
    `login.migros.ch rate-limited until ${until}; ` +
    `reason: ${session.rateLimitReason ?? "unknown"}. ` +
    `Cached JWT is also expired — cannot re-authenticate until the rate limit clears.`
  );
}
