# migros-mcp

Search [Migros](https://www.migros.ch) products, get nutrition facts, find stores, and browse promotions with Claude.

> **Important**
> This is **not affiliated with Migros** in any way.
> It uses publicly accessible API endpoints -- there is no official Migros API.
> It can **break at any time** if Migros changes their endpoints.
> No authentication required -- uses guest access only.
> **Use at your own risk.**

## What you can do

Once installed, just talk to Claude naturally:

- "Search Migros for protein bars"
- "What's the nutrition info for this Migros product?"
- "Find Migros stores near Zurich"
- "What promotions does Migros have right now?"
- "Compare the protein content of these two products"
- "Which Migros products are gluten-free?"

## Install

No accounts or credentials needed. This server uses Migros guest access.

### Claude Desktop (recommended)

1. Download [migros-mcp.mcpb](https://github.com/lewpgs/migros-mcp/releases/latest/download/migros-mcp.mcpb)
2. Install it:

   **macOS** - Double-click the file, or drag and drop it onto the Claude Desktop app icon

   **Windows** - In Claude Desktop, go to File > Settings > Extensions > Advanced Settings > Install Extension and select the file

That's it. No credentials needed.

---

## Advanced setup

These methods require [Node.js 18+](https://nodejs.org) installed on your machine.

### Claude Code

```bash
claude mcp add migros -- npx -y migros-mcp
```

### Claude Desktop (manual) / Cursor

Add the following to your config file:

- **Claude Desktop** - `claude_desktop_config.json`
- **Cursor** - `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

```json
{
  "mcpServers": {
    "migros": {
      "command": "npx",
      "args": ["-y", "migros-mcp"]
    }
  }
}
```

### Test connection

```bash
npx migros-mcp
```

## Available tools

| Tool | Description |
|---|---|
| `search_products` | Search Migros products by name or keyword. Returns product IDs. |
| `get_product_details` | Get full product info: nutrition, ingredients, allergens, price, ratings. |
| `get_categories` | List all Migros product categories. |
| `search_stores` | Find Migros stores by location with addresses and opening hours. |
| `get_promotions` | Search current Migros promotions and deals. |

## How it works

Migros does not offer a public API. This MCP server uses the [migros-api-wrapper](https://www.npmjs.com/package/migros-api-wrapper) package, which wraps the same endpoints that the Migros website and app use internally. A guest token is obtained at startup (no login required) and cached for the session.

Product searches return IDs that you then pass to `get_product_details` for full nutrition tables, ingredients, allergens, and pricing.

## Development

```bash
git clone https://github.com/lewpgs/migros-mcp.git
cd migros-mcp
npm install
npm run build
node dist/index.js
```

Debug with the MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector npx migros-mcp
```

## Disclaimers

- **Unofficial** - This project is not affiliated with, endorsed by, or connected to Migros in any way.
- **No official API** - This server uses publicly accessible API endpoints that power the Migros website. These are not documented or officially supported. Changes to Migros infrastructure could break this server without notice.
- **No authentication required** - Uses guest access only. No credentials are stored or transmitted.
- **Use at your own risk** - No guarantees of functionality, availability, or compatibility.

## License

MIT
