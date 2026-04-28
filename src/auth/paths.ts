import os from "node:os";
import path from "node:path";

const APP = "migros-mcp";

/**
 * OS-appropriate user config directory for this MCP.
 * Created lazily by callers; this function does not touch the filesystem.
 *
 * - macOS:   ~/Library/Application Support/migros-mcp
 * - Linux:   $XDG_CONFIG_HOME/migros-mcp  (or ~/.config/migros-mcp)
 * - Windows: %APPDATA%/migros-mcp
 */
export function configDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? home, APP);
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), APP);
}

/** Path to the persisted session (cookies + cached JWT). */
export function sessionFile(): string {
  return path.join(configDir(), "session.json");
}
