/**
 * Unit tests for rate-limit handling (429 Too Many Requests).
 *
 * No network, no credentials — pure logic tests using node:test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRetryAfter,
  rateLimitBackoff,
  RateLimitError,
  isRateLimited,
  setRateLimited,
  clearRateLimit,
  rateLimitBlockedMessage,
} from "../src/auth/rate-limit.js";

// ---------------------------------------------------------------------------
// parseRetryAfter
// ---------------------------------------------------------------------------

describe("parseRetryAfter", () => {
  it("parses an integer second value", () => {
    assert.equal(parseRetryAfter("120"), 120);
  });

  it("parses a zero value", () => {
    assert.equal(parseRetryAfter("0"), 0);
  });

  it("parses leading/trailing whitespace", () => {
    assert.equal(parseRetryAfter("  30  "), 30);
  });

  it("returns null for undefined", () => {
    assert.equal(parseRetryAfter(undefined), null);
  });

  it("returns null for null", () => {
    assert.equal(parseRetryAfter(null), null);
  });

  it("returns null for an empty string", () => {
    assert.equal(parseRetryAfter(""), null);
  });

  it("parses an HTTP-date (RFC 7231)", () => {
    // 60 seconds from now
    const future = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfter(future);
    assert.ok(result !== null && result >= 58 && result <= 62,
      "expected ~60 s, got " + result);
  });

  it("clamps a past HTTP-date to 0 (retry immediately)", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    assert.equal(parseRetryAfter(past), 0);
  });

  it("returns null for a non-numeric non-date string", () => {
    assert.equal(parseRetryAfter("tomorrow"), null);
  });

  it("returns null for a negative integer string", () => {
    // -1 is not a valid Retry-After; treat as unparseable
    assert.equal(parseRetryAfter("-1"), null);
  });
});

// ---------------------------------------------------------------------------
// rateLimitBackoff
// ---------------------------------------------------------------------------

describe("rateLimitBackoff", () => {
  it("returns 30 s for attempt 0", () => {
    assert.equal(rateLimitBackoff(0), 30_000);
  });

  it("returns 2 min for attempt 1", () => {
    assert.equal(rateLimitBackoff(1), 120_000);
  });

  it("returns 10 min for attempt 2", () => {
    assert.equal(rateLimitBackoff(2), 600_000);
  });

  it("caps at 10 min for attempt 3+", () => {
    assert.equal(rateLimitBackoff(10), 600_000);
  });
});

// ---------------------------------------------------------------------------
// RateLimitError
// ---------------------------------------------------------------------------

describe("RateLimitError", () => {
  it("carries retryAfterSeconds", () => {
    const err = new RateLimitError("throttled", 120);
    assert.equal(err.retryAfterSeconds, 120);
    assert.ok(err instanceof Error);
    assert.equal(err.name, "RateLimitError");
  });

  it("defaults retryAfterSeconds to null", () => {
    const err = new RateLimitError("throttled");
    assert.equal(err.retryAfterSeconds, null);
  });
});

// ---------------------------------------------------------------------------
// isRateLimited
// ---------------------------------------------------------------------------

describe("isRateLimited", () => {
  it("returns false when rateLimitedUntil is absent", () => {
    assert.equal(isRateLimited({}), false);
  });

  it("returns false when rateLimitedUntil is undefined", () => {
    assert.equal(isRateLimited({ rateLimitedUntil: undefined }), false);
  });

  it("returns true when cooldown is in the future", () => {
    const future = Date.now() + 60_000;
    assert.equal(isRateLimited({ rateLimitedUntil: future }), true);
  });

  it("returns false when cooldown has expired", () => {
    const past = Date.now() - 60_000;
    assert.equal(isRateLimited({ rateLimitedUntil: past }), false);
  });

  it("returns false for zero (expired)", () => {
    assert.equal(isRateLimited({ rateLimitedUntil: 0 }), false);
  });
});

// ---------------------------------------------------------------------------
// setRateLimited / clearRateLimit
// ---------------------------------------------------------------------------

describe("setRateLimited / clearRateLimit", () => {
  it("sets rateLimitedUntil to now + Retry-After seconds", () => {
    const s: { rateLimitedUntil?: number; rateLimitReason?: string } = {};
    const before = Date.now();
    setRateLimited(s, 30, "test 429");
    const after = Date.now();

    assert.ok(typeof s.rateLimitedUntil === "number");
    // Should be roughly before + 30000
    assert.ok(
      s.rateLimitedUntil! >= before + 29_000 && s.rateLimitedUntil! <= after + 31_000,
      "rateLimitedUntil: " + s.rateLimitedUntil + " before: " + before + " after: " + after,
    );
    assert.equal(s.rateLimitReason, "test 429");
  });

  it("falls back to 30 s backoff when Retry-After is null", () => {
    const s: { rateLimitedUntil?: number; rateLimitReason?: string } = {};
    const before = Date.now();
    setRateLimited(s, null, "no header");
    const after = Date.now();

    assert.ok(typeof s.rateLimitedUntil === "number");
    assert.ok(
      s.rateLimitedUntil! >= before + 29_000 && s.rateLimitedUntil! <= after + 31_000,
    );
  });

  it("clearRateLimit removes both fields", () => {
    const s: { rateLimitedUntil?: number; rateLimitReason?: string } = {
      rateLimitedUntil: 99999,
      rateLimitReason: "bad",
    };
    clearRateLimit(s);
    assert.equal(s.rateLimitedUntil, undefined);
    assert.equal(s.rateLimitReason, undefined);
  });
});

// ---------------------------------------------------------------------------
// rateLimitBlockedMessage
// ---------------------------------------------------------------------------

describe("rateLimitBlockedMessage", () => {
  it("includes the ISO timestamp and reason", () => {
    const until = Date.now() + 120_000;
    const msg = rateLimitBlockedMessage({
      rateLimitedUntil: until,
      rateLimitReason: "silent SSO -> 429",
    });
    assert.ok(msg.includes(new Date(until).toISOString()));
    assert.ok(msg.includes("silent SSO -> 429"));
    assert.ok(msg.includes("rate-limited"));
  });

  it("handles missing reason gracefully", () => {
    const until = Date.now() + 5000;
    const msg = rateLimitBlockedMessage({ rateLimitedUntil: until });
    assert.ok(msg.includes("unknown"));
  });

  it("handles missing timestamp gracefully", () => {
    const msg = rateLimitBlockedMessage({});
    assert.ok(msg.includes("unknown"));
  });
});
