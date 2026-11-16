/**
 * After a failed login, the next tool calls must not log in again at once
 * (Migros blocks IPs with many half-finished logins), and a bot-check page is
 * named as such. No network: the login client gets a fake axios adapter.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { client } from "../src/auth/oauth.js";
import { getJwt, refreshJwt, resetLoginBackoff, serialized } from "../src/auth/index.js";
import { saveSession } from "../src/auth/cookies.js";
import { sessionFile } from "../src/auth/paths.js";

const creds = { email: "someone@example.org", password: "secret-password" };
const BOT_CHECK =
  "<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x.js'></script></html>";

let tmpConfig: string;
const savedEnv = { ...process.env };
let loginPageRequests = 0;

beforeEach(() => {
  resetLoginBackoff();
  tmpConfig = fs.mkdtempSync(path.join(os.tmpdir(), "migros-backoff-test-"));
  process.env.HOME = tmpConfig;
  process.env.APPDATA = tmpConfig;
  process.env.XDG_CONFIG_HOME = tmpConfig;
  assert.ok(sessionFile().startsWith(tmpConfig), "refusing to run: session file outside the temp dir");
  loginPageRequests = 0;
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? "";
    const answer = (status: number, data = "", headers: Record<string, string> = {}) => ({
      status,
      statusText: "",
      headers,
      data,
      config,
    });
    // No saved session: the silent login fails, so a full login is needed.
    if (url.startsWith("https://www.migros.ch/authentication/public/v1/api/oauth/authorize")) return answer(401);
    if (url === "https://login.migros.ch/login") {
      loginPageRequests++;
      return answer(403, BOT_CHECK, { "cf-mitigated": "challenge" });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  client().defaults.adapter = adapter;
});

afterEach(() => {
  client().defaults.adapter = undefined;
  resetLoginBackoff();
  process.env = { ...savedEnv };
  fs.rmSync(tmpConfig, { recursive: true, force: true });
});

describe("login backoff", () => {
  it("names Cloudflare's bot check instead of a missing CSRF token", async () => {
    await assert.rejects(getJwt(creds), /bot check instead \(Cloudflare\)/);
  });

  it("doesn't start another login right after a failed one", async () => {
    await assert.rejects(getJwt(creds), /bot check/);
    assert.equal(loginPageRequests, 1);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(getJwt(creds), /last Migros login failed \(.*bot check.*\)\. Not trying again for \d+ s/);
    }
    assert.equal(loginPageRequests, 1, "the login page was asked again during the backoff");
  });

  it("tries again at once when the user gives a fresh 2FA code", async () => {
    await assert.rejects(getJwt(creds), /bot check/);
    await assert.rejects(getJwt({ ...creds, totpCode: "123456" }), /bot check/);
    assert.equal(loginPageRequests, 2);
  });

  it("parallel calls share one login attempt", async () => {
    const calls = await Promise.allSettled([getJwt(creds), getJwt(creds), getJwt(creds)]);
    assert.ok(calls.every((c) => c.status === "rejected"));
    assert.equal(loginPageRequests, 1);
  });
});

describe("authenticate without a code on a 2FA account", () => {
  let passwordPosts = 0;
  beforeEach(() => {
    passwordPosts = 0;
    const form = (action: string) => `<form action="${action}"><input name="_csrf" value="t"></form>`;
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      const url = config.url ?? "";
      const answer = (status: number, data = "", headers: Record<string, string> = {}) => ({
        status,
        statusText: "",
        headers,
        data,
        config,
      });
      const method = (config.method ?? "get").toLowerCase();
      if (url.startsWith("https://www.migros.ch/authentication/public/v1/api/oauth/authorize")) return answer(401);
      if (method === "get" && url === "https://login.migros.ch/login") return answer(200, form("/login/email"));
      if (method === "post" && url === "https://login.migros.ch/login/email")
        return answer(302, "", { location: "/login/password" });
      if (method === "get" && url === "https://login.migros.ch/login/password")
        return answer(200, form("/login/password"));
      if (method === "post" && url === "https://login.migros.ch/login/password") {
        passwordPosts++;
        return answer(302, "", { location: "/login/authenticator" });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };
    client().defaults.adapter = adapter;
  });

  it("sends the password once, then asks for the code without contacting Migros", async () => {
    for (let i = 0; i < 5; i++) {
      await assert.rejects(getJwt(creds, { tryLoginWithoutCode: true }), /fresh_code_required/);
    }
    assert.equal(passwordPosts, 1, "the password was sent again without a code");
  });

  it("other tools don't log in at all once the account is known to need a code", async () => {
    await assert.rejects(getJwt(creds, { tryLoginWithoutCode: true }), /fresh_code_required/);
    resetLoginBackoff();
    await assert.rejects(getJwt(creds), /fresh_code_required/);
    assert.equal(passwordPosts, 1);
  });
});

describe("one login at a time", () => {
  it("runs tasks one after another, and a failure doesn't block the next", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number, fail = false) =>
      serialized(async () => {
        order.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([slow("a", 30, true), slow("b", 1), slow("c", 1)]);
    assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["rejected", "fulfilled", "fulfilled"]
    );
  });

  it("after a 401, reuses a token another call already refreshed instead of logging in again", async () => {
    saveSession({ cookies: {}, jwt: "new-token-from-other-call", jwtExp: Math.floor(Date.now() / 1000) + 3600 });
    assert.equal(await refreshJwt("old-rejected-token"), "new-token-from-other-call");
    assert.equal(loginPageRequests, 0);
  });
});
