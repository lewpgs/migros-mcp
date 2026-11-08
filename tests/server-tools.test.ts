/**
 * The server starts and offers exactly the tools that manifest.json (the
 * Claude Desktop installer) lists. No network: listing tools calls nothing,
 * and the server runs with a throwaway home folder.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function listServerTools(): Promise<string[]> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "migros-tools-test-"));
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    // Only what the server needs: no Migros credentials, no real config folder.
    // TMPDIR/TEMP/TMP keep tsx's cache in the same temp area as the test.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_CONFIG_HOME: home,
      APPDATA: home,
      TMPDIR: os.tmpdir(),
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise<string[]>((resolve, reject) => {
    let buf = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error("server did not answer within 20 s: " + stderr)), 20_000);
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");

    function finish(err: Error | null, tools?: string[]) {
      clearTimeout(timer);
      child.kill();
      fs.rmSync(home, { recursive: true, force: true });
      if (err) reject(err);
      else resolve(tools!);
    }

    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => finish(new Error(`server exited early (${code}): ${stderr}`)));
    child.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        } else if (msg.id === 2) {
          child.removeAllListeners("exit");
          finish(null, msg.result.tools.map((t: { name: string }) => t.name));
        }
      }
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
  });
}

describe("server", () => {
  it("starts and lists the same tools as manifest.json", async () => {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")) as { tools: Array<{ name: string }> };
    const declared = manifest.tools.map((t) => t.name).sort();
    const offered = (await listServerTools()).sort();
    assert.deepEqual(offered, declared);
  });
});
