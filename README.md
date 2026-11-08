# migros-mcp

Lets Claude (and other AI apps) search [Migros](https://www.migros.ch) products, recipes, stores and promotions. Sign in, and it can also manage your basket and look up your orders, receipts and Cumulus points.

> **Unofficial.** Not made or supported by Migros. It uses the same behind-the-scenes addresses as the Migros website, so it can break whenever Migros changes them. Use at your own risk.

## Install

It runs on your own computer, so it works in desktop apps that can start a program: Claude Desktop, Claude Code, Cursor and similar. It doesn't work on claude.ai in a browser or in the Claude phone apps.

### Claude Desktop

1. Download **[migros-mcp.mcpb](https://github.com/lewpgs/migros-mcp/releases/latest/download/migros-mcp.mcpb)**.
2. Open Claude's settings: on Windows, the menu > **File** > **Settings**. On a Mac, **Claude** > **Settings** in the menu bar.
3. Go to **Desktop app**, scroll down to **Extensions** and click **Manage**.
4. Drag the downloaded file onto that page, then click **Install**.
5. Claude asks for your Migros details. Leave them all blank to only search. Fill in your email and password to use your basket and orders (see [Your Migros account](#your-migros-account)).

Nothing else to install.

### Claude Code

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
claude mcp add migros -- npx -y migros-mcp
```

With your Migros account:

```bash
claude mcp add migros \
  -e MIGROS_EMAIL=you@example.com \
  -e MIGROS_PASSWORD='your-password' \
  -- npx -y migros-mcp
```

### Cursor and other apps

Needs [Node.js](https://nodejs.org) 22 or newer. Add this to the app's MCP config file:

- **Cursor:** `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project)
- **Claude Desktop without the installer:** Settings > Developer > Edit Config

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

Leave out the `env` block to only search. Other apps (VS Code, Windsurf, Zed and so on) run the same command, `npx -y migros-mcp`, but lay out their config a little differently. Check your app's MCP instructions.

### Check that it works

Start a new chat and ask: *"Search Migros for oat milk."*

## Your Migros account

Optional. Without it, product search, product details, stock, stores, promotions and recipes all work.

With it, Claude can also see and change your basket and look up your orders, in-store receipts and Cumulus points. It **never places an order or pays**. It gives you a checkout link, and you finish on migros.ch yourself.

What to enter depends on how you sign in to migros.ch:

| You sign in with | Enter |
|---|---|
| Email and password | Email and password. Done. |
| Email, password and a 6-digit code from an authenticator app | Email and password. When Claude needs to sign in, it asks you for the current code. That only happens when Migros ends the saved login, not in every chat. |
| The same, but you never want to be asked for a code | Email, password and your **setup key** (see below). |

<details>
<summary><b>Finding your setup key</b> (only needed for the last option)</summary>

<br>

The setup key (also called the TOTP secret) is **not** the 6-digit code. It's the long code, about 32 letters and digits like `JBSWY3DPEHPK3PXP...`, that you got when you first added Migros to your authenticator app. It never changes.

- **Saved in a password manager?** Open the Migros entry and look for an option like "View one-time password secret". If you see a link starting with `otpauth://`, the setup key is the part after `secret=`.
- **Not saved anywhere?** Migros only shows it while you set up 2FA. In your Migros account settings, remove 2FA and set it up again. Under the QR code is a box saying *"Or enter the following key in the authenticator app"*. Copy that key before you finish, and add the new entry to your authenticator app.

In Claude Desktop it goes in the *Migros TOTP Secret* field. Everywhere else, add `MIGROS_TOTP_SECRET` next to the email and password (`-e MIGROS_TOTP_SECRET=...` with `claude mcp add`, or one more line in the `env` block).

</details>

Only codes from an authenticator app work. If your account uses a passkey only, or codes by SMS, add an authenticator app in your Migros account settings first.

## What you can ask

Without an account:

- "Search Migros for protein bars"
- "What's the nutrition info for this product?"
- "Find Migros stores near Zurich"
- "What promotions does Migros have right now?"
- "Find me a risotto recipe"

With your account:

- "What's in my Migros basket?"
- "Add 2 litres of milk to my basket"
- "Add the ingredients for this recipe to my basket"
- "Show me my last 5 Migros orders"
- "How much did I spend at Migros last month?"
- "What was on my last in-store receipt?"
- "Which Cumulus coupons do I have?"
- "Give me the link to finish my checkout"

## Updating

| You installed with | To update |
|---|---|
| `npx -y migros-mcp` (Claude Code, Cursor, a config file) | Nothing to do. You get the new version the next time the app starts. |
| The `.mcpb` file in Claude Desktop | Download the [latest migros-mcp.mcpb](https://github.com/lewpgs/migros-mcp/releases/latest/download/migros-mcp.mcpb) and open it again. Your saved details stay. |
| A fixed version, like `migros-mcp@0.4.0` | Change the number, or remove `@0.4.0` to always get the newest. |

Stuck on an old version with npx? Run `npm cache clean --force` and restart the app.

**Update notice.** About once a day, while you use it, migros-mcp asks the npm registry for the newest version number. If a newer one is out, one answer a day ends with a short line saying so. Nothing about you is sent (npm sees your IP address, as with any download). To turn it off: in Claude Desktop, untick *Tell me when a new version is out* in the extension's settings (Settings > Desktop app > Extensions > Manage). Anywhere else, set `MIGROS_MCP_UPDATE_CHECK=false` (`-e MIGROS_MCP_UPDATE_CHECK=false` with `claude mcp add`, or one more line in the `env` block).

## Privacy and safety

- Your email, password and setup key are only ever sent to Migros' own login page (`login.migros.ch`). A 6-digit code you give Claude is used for that one sign-in and never stored or logged.
- The Claude Desktop installer keeps your password and setup key in your computer's keychain. With npx (Claude Code, Cursor, a config file) they sit in plain text in that app's config file.
- Once you're signed in, the saved login (cookies and an access token) stays on your computer, in `session.json`:
  - Mac: `~/Library/Application Support/migros-mcp/`
  - Windows: `%APPDATA%\migros-mcp\`
  - Linux: `~/.config/migros-mcp/` (or `$XDG_CONFIG_HOME/migros-mcp/`)

  Deleting that file signs you out.
- It never places orders or pays. `get_checkout_link` gives you a link, and you finish on migros.ch.

## Troubleshooting

- **"Too many requests" or other sign-in errors.** Migros blocks computers that sign in too often. When that happens, migros-mcp stops trying for a while on its own (30 seconds at first, longer if it keeps happening) and keeps using your current login while it's still valid. The error says until when. Wait until then before trying again. Restarting the app over and over, or a wrong password, makes it worse.
- **Something that used to work fails.** Migros may have changed its website. Update to the newest version (see [Updating](#updating)), and if it still fails, [open an issue](https://github.com/lewpgs/migros-mcp/issues).

## Tools

These are what Claude calls behind the scenes. You don't need them to use it.

**Without an account**

| Tool | What it does |
|---|---|
| `search_products` | Search products by name or keyword, including ones sold only online (such as "Partner" products). |
| `get_product_details` | Nutrition, ingredients, allergens, price and ratings. Online-only products also get their online price and a Partner flag. |
| `get_stock` | Whether a product is in stock at a given store. Updated once a day. |
| `get_categories` | All Migros product categories. |
| `search_stores` | Stores near a place, with addresses and opening hours. |
| `get_promotions` | Current promotions and deals. |
| `search_recipes` | Search Migusto, Migros' recipe site, by text and/or ingredients. German, French and Italian only. |
| `get_recipe_details` | A full recipe: ingredients, steps, photos, nutrition. |
| `get_recipe_products` | The Migros products Migusto suggests for a recipe, with name and price, ready for `add_to_basket`. |

**With your account**

| Tool | What it does |
|---|---|
| `authenticate` | Sign in with the current 6-digit code. Only used when no setup key is saved. |
| `get_profile` | Your name, email and language. |
| `get_addresses` | Your saved delivery and billing addresses. |
| `get_shopping_lists` | Your shopping lists by name, for people with more than one. |
| `get_basket` | What's in your basket. |
| `add_to_basket` | Add a product (1 by default). |
| `update_basket_quantity` | Set how many of an item you want (0 removes it). |
| `remove_from_basket` | Remove an item. |
| `get_orders` | Your online orders, page by page, filterable by status. |
| `get_order_details` | One order in full. |
| `get_checkout_link` | A link to finish checkout on migros.ch. |
| `get_cumulus_status` | Your Cumulus card: points collected this period, card number, cardholder, memberships. |
| `get_in_store_receipts` | Your in-store receipts (Kassenbons) for a date range. |
| `get_receipt_details` | A link to see one receipt's items. |
| `get_cumulus_coupons` | Your current personal Cumulus coupons. |

<details>
<summary><b>How it works</b></summary>

<br>

- **Without an account**, it uses [migros-api-wrapper](https://www.npmjs.com/package/migros-api-wrapper) and the same addresses the Migros website calls, with a guest token it fetches at startup.
- **With an account**, it signs in at `login.migros.ch` the way a browser does (email, then password, then the 2FA code if your account has one) and saves the login. The access token only lasts a short while, so it's renewed quietly from the saved login, without signing in again. A full sign-in only happens when Migros ends the saved login.
- Saving the login matters because Migros' sign-in page sits behind Cloudflare, which blocks computers that sign in too often.
- Without a setup key, once it knows your account needs a code, it waits until Claude has one before sending your password. That way it never starts a sign-in it can't finish.

</details>

## Development

```bash
git clone https://github.com/lewpgs/migros-mcp.git
cd migros-mcp
npm install
npm run build
npm test
```

Check the tools that need no account against the live Migros website. GitHub also runs this every Monday, so a change on Migros' side shows up early:

```bash
npm run live-check
```

Try it with the MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
