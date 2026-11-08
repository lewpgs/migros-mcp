import { createRequire } from "node:module";

/**
 * Tells people when a newer migros-mcp is out.
 *
 * npx installs pick up new releases on their own, but the Claude Desktop
 * installer (.mcpb) stays on the version it was installed with, and nothing
 * tells its users that a fix is out. So, at most once a day and only while a
 * tool is being used, the server asks the npm registry for the latest version
 * number. When it is newer than this one, one tool result a day gets an extra
 * line with the update link.
 *
 * Nothing about the user is sent: it is a plain request for public package
 * information. MIGROS_MCP_UPDATE_CHECK=false turns it off (in Claude Desktop,
 * the installer's "Tell me when a new version is out" box sets it).
 */

const LATEST_URL = "https://registry.npmjs.org/migros-mcp/latest";
export const UPDATE_HELP_URL = "https://github.com/lewpgs/migros-mcp#updating";
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 5_000;
/** The registry's answer is a few KB; anything far bigger is not what we asked for. */
const MAX_RESPONSE_CHARS = 200_000;

export type FetchLatest = () => Promise<unknown>;

/** "1.2.3" -> [1, 2, 3]. Anything else, pre-releases included, -> null. */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a plain version number higher than `current`. */
export function isNewer(latest: unknown, current: unknown): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function noticeText(latest: string, current: string): string {
  return `Update available: migros-mcp ${latest} is out (this is ${current}). How to update: ${UPDATE_HELP_URL}`;
}

/** The version in this package's package.json, or null if it can't be read. */
export function installedVersion(): string | null {
  try {
    // dist/update-check.js and src/update-check.ts both sit one folder below package.json,
    // in the npm package and in the Claude Desktop installer alike.
    const v = (createRequire(import.meta.url)("../package.json") as { version?: unknown }).version;
    return parseVersion(v) ? (v as string) : null;
  } catch {
    return null;
  }
}

/** Asks the npm registry for the latest published version. Throws on any problem. */
export const fetchLatestFromNpm: FetchLatest = async () => {
  const r = await fetch(LATEST_URL, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`npm registry answered ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error("npm registry answer too large");
  return (JSON.parse(text) as { version?: unknown }).version;
};

export class UpdateChecker {
  private lastCheckAt = -Infinity;
  private lastShownAt = -Infinity;
  private checking = false;
  private latest: string | null = null;

  constructor(
    private readonly current: string | null,
    private readonly fetchLatest: FetchLatest = fetchLatestFromNpm,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Call once per tool call. Starts a check in the background when the last
   * one is a day old (never waits for it), and returns the notice to show,
   * or null. The notice comes at most once a day.
   */
  onToolCall(): string | null {
    if (!this.current) return null;
    const t = this.now();

    if (!this.checking && t - this.lastCheckAt >= DAY_MS) {
      this.lastCheckAt = t;
      this.checking = true;
      this.fetchLatest()
        .then((v) => {
          // Only a plain version number is kept, so nothing else from the
          // registry's answer can end up in a tool result.
          if (parseVersion(v)) this.latest = v as string;
        })
        .catch(() => {
          // No answer, no notice. Tools work the same either way.
        })
        .finally(() => {
          this.checking = false;
        });
    }

    if (this.latest && isNewer(this.latest, this.current) && t - this.lastShownAt >= DAY_MS) {
      this.lastShownAt = t;
      return noticeText(this.latest, this.current);
    }
    return null;
  }
}

let checker: UpdateChecker | null = null;

/** On unless MIGROS_MCP_UPDATE_CHECK says false, 0, off or no. */
export function updateCheckWanted(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.MIGROS_MCP_UPDATE_CHECK ?? "").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(v);
}

/** Called once when the server starts. Off until then, so tests never reach the network. */
export function enableUpdateCheck(): void {
  if (updateCheckWanted()) checker = new UpdateChecker(installedVersion());
}

/** The notice for this tool call, or null. */
export function updateNotice(): string | null {
  return checker?.onToolCall() ?? null;
}
