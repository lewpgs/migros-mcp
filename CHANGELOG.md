# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-11-08

### Fixed

- **`get_cumulus_status` works again.** Migros moved the address it used, so it answered 404 for everyone. It now reads the Cumulus profile from the address the migros.ch website uses. It returns `pointsBalance` (points collected in the current period), `cumulusNumber`, `cardholder`, `memberships` and `isFamigrosMember`. Migros no longer sends a level or lifetime points, so `level`, `lifetimePoints` and `cardholderTitle` are gone, and `cumulusId` is now `cumulusNumber`. An account without a Cumulus card gets `hasCumulus: false` instead of an error.

### Changed

- The README is shorter and easier to follow: install steps per app (with Claude Desktop's current Settings path), one table for what to enter depending on how you sign in, and new "Privacy and safety" and "Troubleshooting" sections.

## [0.5.0] - 2026-11-08

### Fixed

- **Three tools that stopped working for everyone are back.** Migros moved two of the addresses this server used.
  - `get_categories` answered 404. It now reads the category tree from Migros's new address.
  - `search_recipes` and `get_recipe_products` got a web page instead of data, because Migusto (Migros's recipe site) moved to a new website and switched off its old API. `search_recipes` now reads Migusto's recipe list (the page its search box leads to), 24 recipes per page, with `limit` and `offset` working as before. `get_recipe_products` uses migros.ch's own recipe API, which has the same recipes and the same recipe ids. (migros.ch's API has a search too, but it ignores the search text.)
  - `get_recipe_details` kept working but always returned an empty `id`. It now returns the recipe's id, plus `url`, `description` and `nutrition`.
- `get_product_details` showed "CHF undefined" for a product Migros lists without a price (for example out of season). The price is now left out instead.

### Changed

- **`get_recipe_products` returns products, not just ids.** Before: `{ productIds }`, Migusto's raw list. Now: `recipeId`, `title`, `count`, `total`, `products` (each with `uid`, `migrosId`, `name`, `brand`, `price`, `quantity` where Migros knows them) and `productIds`, which now holds the **uids** that `add_to_basket` takes. The products are the ones Migusto suggests for the recipe under "Zutaten in deiner Migros". `recipeId` must be the numeric id from `search_recipes`.
- `search_recipes` keeps its fields. `url` now points at the new Migusto address (`/de/rezepte/<slug>/<id>`), `image` is a 640-pixel-wide picture and `total` is the number of matching recipes. If `offset` and `limit` reach past the page Migusto sends, fewer recipes come back; ask again from the next offset.

### Security

- Dependencies refreshed within their existing version ranges (`npm audit fix`), which clears 16 of 19 known advisories. Most were in parts of the MCP SDK this server doesn't use (its HTTP server), and npx installs already picked up the newer versions on their own. The Claude Desktop installer is built from the lockfile, so it gets them with the next release. The three left need breaking upgrades (zod 4) or come through migros-api-wrapper, and are low risk here.

### Added

- **Update notice.** The Claude Desktop installer (`.mcpb`) doesn't update itself, so its users didn't know when a fix was out. About once a day, while a tool is in use, the server now asks the npm registry for the latest version number, in the background. When a newer one is out, one tool result a day ends with a separate line saying so, with a link to the README's *Updating* section. Nothing about the user is sent, tools never wait for the check, and only a plain version number from the registry's answer is ever shown. To turn it off, untick the new *Tell me when a new version is out* box in the Claude Desktop installer's settings, or set `MIGROS_MCP_UPDATE_CHECK=false` anywhere else.
- The README now says which apps it works in: apps on your own computer, not claude.ai in a browser or the phone apps.
- GitHub Actions check: every pull request and every push to main is built and tested on Node 22 and 24, read-only and without secrets.
- A test that starts the server and checks it offers exactly the tools listed in `manifest.json`.

## [0.4.1] - 2026-11-08

### Fixed

- **Products sold only online can be found and added to the basket** (#8). Some products exist only in the Migros Online shop, for example "Partner" products marked "not available in stores". `search_products` now also asks the online shop's search and adds those products after the usual results, listed again in `onlineOnlyProductIds`. `get_product_details` adds their online price, a `partner` flag, availability and the website link (before, they came back without a price). They go into the basket with `add_to_basket` like any other product. If the online search fails, results are the same as before.

## [0.4.0] - 2026-11-08

### Added

- **`authenticate` tool**: log in with the current six-digit 2FA code instead of storing the TOTP seed. The AI asks the user for the code, or reads it from a password manager. `MIGROS_TOTP_SECRET` keeps working exactly as before.
- **`get_shopping_lists` tool**: lists the user's shopping lists by name, so the AI can work on the right one when there are several (#5). `get_checkout_link` now accepts `shoppingListId` too. With one list, nothing changes.

### Changed

- `MIGROS_TOTP_SECRET` is now optional for accounts with 2FA. Without it, authenticated tools return `fresh_code_required` when a login is needed. The MCP remembers that the account needs a code, so it doesn't send the password to Migros until it has one. A rejected code reports Migros' own reason.

### Fixed
- **429 Too Many Requests handling.** When `login.migros.ch` rate-limits the MCP (Cloudflare), the auth layer now:
  - Parses `Retry-After` headers and applies a cooldown persisted in `session.json`.
  - Never cascades a 429 from silent OAuth into a full credentialed login (they share the same host and throttle).
  - Fails open: a still-valid cached JWT is returned even during cooldown so tools keep working.
  - Raises the JWT refresh grace buffer from 60 s to 5 min to reduce silent-OAuth frequency.
  - Falls back to exponential backoff (30 s → 2 min → 10 min) when `Retry-After` is missing. The step resets after a successful login, or an hour after the last cooldown ended.
  - Caps a `Retry-After` cooldown at 1 hour.
  - Saves the cooldown when the token refresh after a 401 hits a 429, so the next call doesn't retry.
  - Surfaces a clear, actionable error when the JWT is expired AND the login host is rate-limited.
- Tests use a temporary config directory on every OS. Before, `npm test` on macOS or Windows overwrote the real `session.json`.

### Documentation
- The **Updating** section now says what npx actually does: recent npm versions check for the newest version each time npx starts, so updates land on the next launch (it said ~7 days before).
- Wording fixes across the README and this changelog.

## [0.3.1] - 2026-04-28

### Documentation
- Added an **Updating** section to the README explaining how releases reach users on each install path (unpinned `npx`, drag-installed `.mcpb`, or manually pinned configs). Triggered by the realization that pinned-version configs make every release require a manual user edit; the recommended install commands have always been unpinned.

## [0.3.0] - 2026-04-28

Major feature release: authenticated user tools (basket, orders, addresses, profile, Cumulus) and recipe search via Migusto. The 6 existing anonymous tools are unchanged and continue to work without credentials.

### Added

- **Authenticated tool suite (11 tools)**: opt-in via `MIGROS_EMAIL` / `MIGROS_PASSWORD` / `MIGROS_TOTP_SECRET` env vars. Anonymous tools work without these.
  - `get_profile`: logged-in customer's profile (name, email, language)
  - `get_addresses`: saved delivery and billing addresses
  - `get_basket`: items in the user's basket (Migros calls it a shopping list)
  - `add_to_basket`: add a product or set its target quantity
  - `update_basket_quantity`: set an item's exact quantity (0 to remove)
  - `remove_from_basket`: convenience wrapper for quantity 0
  - `get_orders`: list online orders, paginated, filterable by status
  - `get_order_details`: full details of one order by id
  - `get_checkout_link`: URL to open in browser to complete checkout (we don't automate payment for safety)
  - `get_cumulus_status`: Cumulus loyalty card (points balance, level, cardholder)
  - `get_in_store_receipts`: list of in-store Kassenbons over a date range
  - `get_receipt_details`: URL to view a receipt's line items in the browser
  - `get_cumulus_coupons`: active personalized Cumulus coupons

- **Recipe tools (3 anonymous tools)**: Migusto integration:
  - `search_recipes`: free-text or ingredient-based search of Migusto's catalogue
  - `get_recipe_details`: full Schema.org recipe by slug
  - `get_recipe_products`: Migros product UIDs the recipe needs, ready to chain into `add_to_basket`

- **OAuth + session persistence**: first auth call runs a credentialed login (email → password → TOTP) and caches cookies + access token. JWT refreshes silently every ~30 min using cached cookies, so subsequent MCP launches don't re-authenticate. Full re-login happens roughly twice a year (when SSO cookies expire). Session lives at:
  - macOS: `~/Library/Application Support/migros-mcp/session.json`
  - Linux: `$XDG_CONFIG_HOME/migros-mcp/session.json`
  - Windows: `%APPDATA%/migros-mcp/session.json`

- **`manifest.json`** for Claude Desktop `.mcpb` install with sensitive `user_config` entries (credentials stored in OS keychain by Claude Desktop).

- **`CHANGELOG.md`** (this file).

### Changed

- README rewritten to document the dual-tier model (anonymous + authenticated) and the order-placement hand-off.
- `src/index.ts` refactored from 470 lines of try/catch boilerplate to 167 lines of declarative `register()` calls.
- Schemas consolidated in `src/schemas.ts` (previously some inline in `index.ts`).
- Authenticated tool implementations split by domain into `src/auth-tools/{account,cart,orders,cumulus}.ts` for easier maintenance.

### Limitations (documented in README)

- 2FA support is TOTP-only. Passkey-only accounts are not yet supported.
- Order placement is intentionally not automated; `get_checkout_link` hands off to the browser.
- In-store receipt line items aren't available via the public API; `get_receipt_details` returns a browser URL instead.
- If the credentialed login is repeatedly retried in a short window (e.g. wrong password retries), Cloudflare may briefly throttle the IP. Wait an hour or refresh via the browser.

## [0.2.1] - 2026-04-28

### Added

- `get_product_details` now accepts the 12-digit `migrosId` in addition to the shorter `uid`. Output also exposes `migrosId` for cross-referencing with `migusto.migros.ch` URLs.

## [0.2.0] - earlier

Initial public release with 6 anonymous tools: `search_products`, `get_product_details`, `get_stock`, `get_categories`, `search_stores`, `get_promotions`.
