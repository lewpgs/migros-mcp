/**
 * Regression tests for cooldown-state persistence across process restarts.
 *
 * The rate-limit cooldown (rateLimitedUntil / rateLimitReason) must survive a
 * loadSession()/saveSession() round-trip — otherwise a process restart loses
 * the cooldown and the next call hammers the rate-limited host again.
 *
 * No network, no credentials. Uses a throwaway XDG_CONFIG_HOME so the real
 * user config dir is never touched.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSession, saveSession, type Session } from "../src/auth/cookies.js";

let tmpConfig: string;

beforeEach(() => {
  tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), "migros-session-test-"));
  process.env.XDG_CONFIG_HOME = tmpConfig;
});

describe("session cooldown persistence", () => {
  it("round-trips rateLimitedUntil and rateLimitReason through disk", () => {
    const session: Session = {
      cookies: { "login.migros.ch": { foo: "bar" } },
      jwt: "eyJ.abc.def",
      jwtExp: 9999999999,
      rateLimitedUntil: Date.now() + 3600_000,
      rateLimitReason: "429 from POST /login/email",
    };
    saveSession(session);

    const loaded = loadSession();
    assert.equal(loaded.rateLimitedUntil, session.rateLimitedUntil, "cooldown end must survive restart");
    assert.equal(loaded.rateLimitReason, session.rateLimitReason, "cooldown reason must survive restart");
  });

  it("keeps cooldown fields when the session has no cookies", () => {
    const session: Session = {
      cookies: {},
      jwt: null,
      jwtExp: 0,
      rateLimitedUntil: Date.now() + 60_000,
      rateLimitReason: "429 from silent SSO",
    };
    saveSession(session);
    const loaded = loadSession();
    assert.equal(loaded.rateLimitedUntil, session.rateLimitedUntil);
    assert.equal(loaded.rateLimitReason, session.rateLimitReason);
  });

  it("returns undefined cooldown fields for a session written without them", () => {
    const session: Session = { cookies: {}, jwt: null, jwtExp: 0 };
    saveSession(session);
    const loaded = loadSession();
    assert.equal(loaded.rateLimitedUntil, undefined);
    assert.equal(loaded.rateLimitReason, undefined);
  });

  it("an expired cooldown timestamp still round-trips (decision logic lives in isRateLimited)", () => {
    const session: Session = {
      cookies: {},
      jwt: null,
      jwtExp: 0,
      rateLimitedUntil: Date.now() - 1000,
      rateLimitReason: "stale",
    };
    saveSession(session);
    const loaded = loadSession();
    assert.equal(loaded.rateLimitedUntil, session.rateLimitedUntil);
    assert.equal(loaded.rateLimitReason, "stale");
  });
});
