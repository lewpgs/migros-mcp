# migros-mcp

Search [Migros](https://www.migros.ch) products and (optionally) manage your basket, addresses, and orders through Claude.

> **Important**
> This is **not affiliated with Migros** in any way.
> It uses publicly accessible API endpoints. There is no official Migros API.
> It can **break at any time** if Migros changes their endpoints.
> **Use at your own risk.**

## What you can do

**Without an account (anonymous access):**
- "Search Migros for protein bars"
- "What's the nutrition info for this Migros product?"
- "Find Migros stores near Zurich"
- "What promotions does Migros have right now?"
- "Compare the protein content of these two products"

**With your Migros account (optional):**
- "What's currently in my Migros basket?"
- "Add 2 liters of milk to my basket"
- "Remove the bananas from my basket"
- "Where will my order be delivered to?"
- "Show me my last 5 Migros orders"
- "Give me the link to finish my checkout"

The basket and order tools require your Migros account credentials. They're optional — if you skip them at install, the anonymous tools still work.

## Install

### Claude Desktop (recommended)

1. Download [migros-mcp.mcpb](https://github.com/lewpgs/migros-mcp/releases/latest/download/migros-mcp.mcpb)
2. Install it:

   **macOS** — Double-click the file, or drag and drop it onto the Claude Desktop app icon

   **Windows** — In Claude Desktop, go to File > Settings > Extensions > Advanced Settings > Install Extension and select the file

3. Optional: enter your Migros email, password, and TOTP secret if you want the basket/order tools. Leave all three blank for anonymous access only. Credentials are stored in your OS keychain by Claude Desktop.

   **TOTP secret** is only needed if you have **TOTP-based two-factor authentication** enabled on your Migros account. Leave it blank if you log in with just a password (no 2FA).

That's it.

---

## Advanced setup

These methods require [Node.js 18+](https://nodejs.org).

### Claude Code

```bash
# Anonymous (search/browse only)
claude mcp add migros -- npx -y migros-mcp

# With your account (basket + orders)
claude mcp add migros \
  -e MIGROS_EMAIL=you@example.com \
  -e MIGROS_PASSWORD='your-password' \
  -e MIGROS_TOTP_SECRET=ABCDEFGHIJKLMNOP \
  -- npx -y migros-mcp
```

### Claude Desktop (manual) / Cursor

Add to your config:

- **Claude Desktop** — `claude_desktop_config.json`
- **Cursor** — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

```json
{
  "mcpServers": {
    "migros": {
      "command": "npx",
      "args": ["-y", "migros-mcp"],
      "env": {
        "MIGROS_EMAIL": "you@example.com",
        "MIGROS_PASSWORD": "your-password",
        "MIGROS_TOTP_SECRET": "ABCDEFGHIJKLMNOP"
      }
    }
  }
}
```

The `env` block is optional. Omit it to use anonymous tools only.

### Test connection

```bash
npx migros-mcp                                                # anonymous
MIGROS_EMAIL=... MIGROS_PASSWORD=... MIGROS_TOTP_SECRET=... npx migros-mcp   # authenticated
```

## Available tools

### Anonymous (no credentials needed)

| Tool | Description |
|---|---|
| `search_products` | Search Migros products by name or keyword. Returns product IDs. |
| `get_product_details` | Full product info: nutrition, ingredients, allergens, price, ratings. |
| `get_stock` | Check product availability at a specific Migros store. Updated once daily. |
| `get_categories` | List all Migros product categories. |
| `search_stores` | Find Migros stores by location with addresses and opening hours. |
| `get_promotions` | Search current Migros promotions and deals. |

### Authenticated (require credentials)

| Tool | Description |
|---|---|
| `get_profile` | Logged-in customer's basic profile (name, email, language). |
| `get_addresses` | Saved delivery and billing addresses. |
| `get_basket` | Items currently in the user's basket. |
| `add_to_basket` | Add a product (sets target quantity, default 1). |
| `update_basket_quantity` | Set an item's exact quantity (0 to remove). |
| `remove_from_basket` | Remove an item entirely. |
| `get_orders` | List your online orders, paginated, filterable by status. |
| `get_order_details` | Full details of a single order by id. |
| `get_checkout_link` | Returns the URL to open in your browser to complete checkout. |

## How it works

### Anonymous tools
Use the [migros-api-wrapper](https://www.npmjs.com/package/migros-api-wrapper) which calls the same endpoints the Migros website uses internally. A guest token is fetched at startup and cached.

### Authenticated tools
Use OAuth 2.0 against `login.migros.ch`. The first call runs a credentialed login (email → password → TOTP) and caches the resulting cookies + access token. Every 30 minutes the token is refreshed silently using cached cookies — no login form re-submission. The session lives at:

- macOS: `~/Library/Application Support/migros-mcp/session.json`
- Linux: `$XDG_CONFIG_HOME/migros-mcp/session.json`
- Windows: `%APPDATA%/migros-mcp/session.json`

If the cached session expires (typically a few weeks), the MCP automatically re-runs the credentialed login.

### Order placement
For safety, this MCP **does not** place orders programmatically. The `get_checkout_link` tool returns a URL the user opens in their real browser to confirm address, delivery slot, and payment via Migros' own checkout flow. Real money requires a real human click.

## Known limitations

- **2FA support is TOTP-only.** Accounts secured with a passkey (and no TOTP fallback) are not supported in v0.3.0. If your Migros account uses passkey as the only second factor, add a TOTP authenticator app in Migros account settings, then provide the TOTP secret to this MCP.
- **No automatic order placement.** See above — `get_checkout_link` hands off to your browser for the actual placement.
- **Cloudflare rate limits.** If the MCP fails the credentialed login repeatedly in a short window (e.g., wrong password retries), Cloudflare may briefly throttle the IP. Wait an hour and retry, or log in via your browser to refresh the session.

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

- **Unofficial** — Not affiliated with, endorsed by, or connected to Migros in any way.
- **No official API** — Uses endpoints that power the Migros website. They are not documented or supported. Migros can change them without notice.
- **Credentials** — When you provide credentials, they're used only to authenticate against `login.migros.ch`. Resulting session cookies and access tokens are stored locally in your OS user config directory. They are never sent anywhere except Migros' own servers.
- **No order placement** — This server does not place orders programmatically. Orders are completed in the user's own browser via the URL returned by `get_checkout_link`.
- **Use at your own risk** — No guarantees of functionality, availability, or compatibility.

## License

MIT
