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
- "Find me a recipe for risotto and add the ingredients to my basket" (combines anonymous recipe search with authenticated cart write)

**With your Migros account (optional):**
- "What's currently in my Migros basket?"
- "Add 2 liters of milk to my basket"
- "Remove the bananas from my basket"
- "Where will my order be delivered to?"
- "Show me my last 5 Migros orders"
- "Give me the link to finish my checkout"
- "How much did I spend at Migros last month?"
- "What was on my last in-store receipt?"
- "Which Cumulus coupons do I have right now?"
- "How many Cumulus points do I have?"

The basket and order tools require your Migros account credentials. They're optional — if you skip them at install, the anonymous tools still work.

## Install

### Claude Desktop (recommended)

1. Download [migros-mcp.mcpb](https://github.com/lewpgs/migros-mcp/releases/latest/download/migros-mcp.mcpb)
2. Install it:

   **macOS** — Double-click the file, or drag and drop it onto the Claude Desktop app icon

   **Windows** — In Claude Desktop, go to File > Settings > Extensions > Advanced Settings > Install Extension and select the file

3. Optional: enter your Migros email and password if you want the basket/order tools. Leave both blank for anonymous access only. Credentials are stored in your OS keychain by Claude Desktop.

   When login is required, call the `authenticate` tool with the current six-digit TOTP code. An agent can obtain that code from an item-capable 1Password MCP, or fall back to the 1Password CLI. The code is used only for that login attempt and is not stored by this MCP.

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
        "MIGROS_PASSWORD": "your-password"
      }
    }
  }
}
```

The `env` block is optional. Omit it to use anonymous tools only.

### Test connection

```bash
npx migros-mcp                                      # anonymous
MIGROS_EMAIL=... MIGROS_PASSWORD=... npx migros-mcp # start with auth configured
```

Then call `authenticate` with the current six-digit TOTP code. If a cached Migros session is still valid, the tool reuses it and the code can be omitted.

## Updating

The recommended install commands above use `npx -y migros-mcp` without pinning a version, so you auto-receive new releases. `npx` caches the package for ~7 days, so updates land on next launch within that window. To force-refresh sooner: `npm cache clean --force` and restart the host.

If you've installed via the **drag-installed `.mcpb`** instead, Claude Desktop pins you to that specific version. Download the latest `.mcpb` from [Releases](https://github.com/lewpgs/migros-mcp/releases) and re-install to update. Your credentials in the OS keychain are preserved across re-installs.

If you've **explicitly pinned** a version in your config (e.g. `migros-mcp@0.3.0`), update by editing the version number or removing the pin entirely.

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
| `search_recipes` | Search Migusto (Migros' recipe site) by query and/or ingredients. German/French/Italian only. |
| `get_recipe_details` | Full recipe by slug: ingredients, instructions, photos, nutrition. |
| `get_recipe_products` | Migros product UIDs for a recipe — feed directly into `add_to_basket`. |

### Authenticated (require credentials)

| Tool | Description |
|---|---|
| `authenticate` | Authenticate with a current six-digit TOTP code; reuses a cached session when possible. If the code is rejected or expires, retrieve a fresh code and retry once. |
| `get_profile` | Logged-in customer's basic profile (name, email, language). |
| `get_addresses` | Saved delivery and billing addresses. |
| `get_basket` | Items currently in the user's basket. |
| `add_to_basket` | Add a product (sets target quantity, default 1). |
| `update_basket_quantity` | Set an item's exact quantity (0 to remove). |
| `remove_from_basket` | Remove an item entirely. |
| `get_orders` | List your online orders, paginated, filterable by status. |
| `get_order_details` | Full details of a single order by id. |
| `get_checkout_link` | Returns the URL to open in your browser to complete checkout. |
| `get_cumulus_status` | Cumulus loyalty card status: points balance, level, cardholder. |
| `get_in_store_receipts` | List in-store receipts (Kassenbons) over a date range. |
| `get_receipt_details` | URL to view a single in-store receipt's line items in the browser. |
| `get_cumulus_coupons` | Active personalized Cumulus coupons. |

## How it works

### Anonymous tools
Use the [migros-api-wrapper](https://www.npmjs.com/package/migros-api-wrapper) which calls the same endpoints the Migros website uses internally. A guest token is fetched at startup and cached.

### Authenticated tools
Use OAuth 2.0 against `login.migros.ch`. When no usable session is cached, call `authenticate` with the current six-digit TOTP code. The MCP performs the credentialed login (email → password → TOTP), then caches the resulting cookies and access token. Every 30 minutes the token is refreshed silently using cached cookies — no login form re-submission.

The agent should retrieve the code only when `authenticate` is needed. An item-capable 1Password MCP is preferred; the 1Password CLI is the fallback when the MCP cannot read the login item's OTP field. This MCP never stores or logs the submitted code.

The cache is persisted across MCP process restarts (Claude Desktop launches, Mac reboots, etc.) so we re-authenticate maybe twice a year instead of dozens of times a day. Migros' login endpoint is behind Cloudflare bot detection that throttles frequent logins, so persistence is what keeps the MCP from getting rate-limited.

The session lives at:

- macOS: `~/Library/Application Support/migros-mcp/session.json`
- Linux: `$XDG_CONFIG_HOME/migros-mcp/session.json`
- Windows: `%APPDATA%/migros-mcp/session.json`

If the cached session expires (typically a few weeks), authenticated tools return `fresh_code_required`; call `authenticate` with a newly retrieved code. The MCP does not reuse a rejected or expired code.

### Order placement
For safety, this MCP **does not** place orders programmatically. The `get_checkout_link` tool returns a URL the user opens in their real browser to confirm address, delivery slot, and payment via Migros' own checkout flow. Real money requires a real human click.

## Known limitations

- **2FA support is TOTP-only.** Accounts secured with a passkey (and no TOTP fallback) are not supported. The agent must provide a current six-digit TOTP code to `authenticate` when a fresh login is required.
- **No automatic order placement.** See above — `get_checkout_link` hands off to your browser for the actual placement.
- **Cloudflare rate limits.** The login host (`login.migros.ch`) sits behind Cloudflare bot detection. If the MCP triggers too many login attempts in quick succession (wrong password retries, repeated restarts without a cached session), the IP may be throttled. When this happens the MCP now sets a **cooldown** (respecting `Retry-After` headers or falling back to 30 s → 2 min → 10 min backoff) and **stops hitting the login host** until it clears. During cooldown, any **still-valid cached JWT keeps working** so your MCP tools may continue serving requests — only re-authentication is paused. If the cached JWT is also expired while rate-limited the MCP will surface a clear error with the cooldown deadline rather than silently retrying and worsening the throttle.

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
- **Credentials** — Email/password are used only to authenticate against `login.migros.ch`. The current TOTP code is accepted only during the login operation and is not persisted or logged. Resulting session cookies and access tokens are stored locally in your OS user config directory. They are never sent anywhere except Migros' own servers.
- **No order placement** — This server does not place orders programmatically. Orders are completed in the user's own browser via the URL returned by `get_checkout_link`.
- **Use at your own risk** — No guarantees of functionality, availability, or compatibility.

## License

MIT
