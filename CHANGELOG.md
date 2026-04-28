# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] — 2026-04-28

### Documentation
- Added an **Updating** section to the README explaining how releases reach users on each install path (unpinned `npx`, drag-installed `.mcpb`, or manually pinned configs). Triggered by the realization that pinned-version configs make every release require a manual user edit; the recommended install commands have always been unpinned.

## [0.3.0] — 2026-04-28

Major feature release: authenticated user tools (basket, orders, addresses, profile, Cumulus) and recipe search via Migusto. The 6 existing anonymous tools are unchanged and continue to work without credentials.

### Added

- **Authenticated tool suite (11 tools)** — opt-in via `MIGROS_EMAIL` / `MIGROS_PASSWORD` / `MIGROS_TOTP_SECRET` env vars. Anonymous tools work without these.
  - `get_profile` — logged-in customer's profile (name, email, language)
  - `get_addresses` — saved delivery and billing addresses
  - `get_basket` — items in the user's basket (Migros calls it a shopping list)
  - `add_to_basket` — add a product or set its target quantity
  - `update_basket_quantity` — set an item's exact quantity (0 to remove)
  - `remove_from_basket` — convenience wrapper for quantity 0
  - `get_orders` — list online orders, paginated, filterable by status
  - `get_order_details` — full details of one order by id
  - `get_checkout_link` — URL to open in browser to complete checkout (we don't automate payment for safety)
  - `get_cumulus_status` — Cumulus loyalty card: points balance, level, cardholder
  - `get_in_store_receipts` — list of in-store Kassenbons over a date range
  - `get_receipt_details` — URL to view a receipt's line items in the browser
  - `get_cumulus_coupons` — active personalized Cumulus coupons

- **Recipe tools (3 anonymous tools)** — Migusto integration:
  - `search_recipes` — free-text or ingredient-based search of Migusto's catalogue
  - `get_recipe_details` — full Schema.org recipe by slug
  - `get_recipe_products` — Migros product UIDs the recipe needs, ready to chain into `add_to_basket`

- **OAuth + session persistence** — first auth call runs a credentialed login (email → password → TOTP) and caches cookies + access token. JWT refreshes silently every ~30 min using cached cookies, so subsequent MCP launches don't re-authenticate. Full re-login happens roughly twice a year (when SSO cookies expire). Session lives at:
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

## [0.2.1] — 2026-04-28

### Added

- `get_product_details` now accepts the 12-digit `migrosId` in addition to the shorter `uid`. Output also exposes `migrosId` for cross-referencing with `migusto.migros.ch` URLs.

## [0.2.0] — earlier

Initial public release with 6 anonymous tools: `search_products`, `get_product_details`, `get_stock`, `get_categories`, `search_stores`, `get_promotions`.
