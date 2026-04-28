import { api } from "./auth/api.js";
import type { Credentials } from "./auth/index.js";

/**
 * Read credentials from env. Returns undefined if not all vars are set, in
 * which case the auth layer falls back to a cached session if one exists.
 */
export function credsFromEnv(): Credentials | undefined {
  const email = process.env.MIGROS_EMAIL;
  const password = process.env.MIGROS_PASSWORD;
  if (!email || !password) return undefined;
  return { email, password, totpSecret: process.env.MIGROS_TOTP_SECRET };
}

/**
 * Fetch the logged-in customer's profile. Returns formatted JSON for the LLM.
 */
export async function getProfile(): Promise<string> {
  const profile = (await api(
    "GET",
    "/retentionapi/public/web/v1/customers/profile",
    undefined,
    { creds: credsFromEnv() }
  )) as Record<string, unknown>;

  return JSON.stringify(
    {
      userId: profile.userId,
      title: profile.title,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      languageCode: profile.languageCode,
      preferredCooperative: profile.preferredCooperative,
    },
    null,
    2
  );
}

interface ShoppingListSummary {
  shoppingListId: number;
  shoppingListName?: string;
}

interface BasketItem {
  id: string;
  type: string;
  quantity: number;
  name?: string;
  note?: string;
  ecomProductAvailability?: string;
}

interface BasketCategory {
  id: number;
  name?: string;
  items?: BasketItem[];
}

interface BasketResponse {
  shoppingListId: number;
  name?: string;
  totals?: {
    instoreTotal?: number;
    onlineTotal?: {
      estimatedTotal?: number;
      freeDelivery?: boolean;
      firstOrder?: boolean;
      minimumOrderValueReached?: boolean;
    };
  };
  categories?: BasketCategory[];
}

/**
 * Resolve the user's primary shopping list id, calling /lists/overview if not
 * provided. Most users have a single list named "Shopping list".
 */
async function resolveShoppingListId(provided?: number): Promise<number> {
  if (typeof provided === "number") return provided;
  const lists = (await api(
    "GET",
    "/shopping-list/public/v1/lists/overview",
    undefined,
    { creds: credsFromEnv() }
  )) as ShoppingListSummary[];
  if (!lists?.length) throw new Error("no shopping lists found for this account");
  return lists[0].shoppingListId;
}

/**
 * Format a basket response into the same flat shape get_basket returns.
 * Used by both reads and writes since the v3/items endpoint returns the
 * full updated basket on each call.
 */
function formatBasket(data: BasketResponse): string {
  const items = (data.categories ?? []).flatMap((c) =>
    (c.items ?? []).map((i) => ({
      productId: i.id,
      type: i.type,
      quantity: i.quantity,
      availability: i.ecomProductAvailability,
      categoryId: c.id,
    }))
  );
  return JSON.stringify(
    {
      shoppingListId: data.shoppingListId,
      name: data.name,
      itemCount: items.length,
      totals: {
        instore: data.totals?.instoreTotal,
        online: data.totals?.onlineTotal?.estimatedTotal,
        freeDelivery: data.totals?.onlineTotal?.freeDelivery,
        firstOrder: data.totals?.onlineTotal?.firstOrder,
        minimumOrderValueReached: data.totals?.onlineTotal?.minimumOrderValueReached,
      },
      items,
      hint:
        items.length > 0
          ? "Use get_product_details with productId to fetch each item's name, price, and other info."
          : "Basket is empty.",
    },
    null,
    2
  );
}

/**
 * Fetch the contents of a shopping list (basket). Returns a flat summary of
 * items + totals. Product names are not returned by this endpoint — call
 * get_product_details with the returned ids to enrich.
 */
export async function getBasket(args: { shoppingListId?: number } = {}): Promise<string> {
  const shoppingListId = await resolveShoppingListId(args.shoppingListId);
  const data = (await api(
    "GET",
    `/shopping-list/public/v2/list/details?shoppingListId=${shoppingListId}`,
    undefined,
    { creds: credsFromEnv() }
  )) as BasketResponse;
  return formatBasket(data);
}

/**
 * Set an item's quantity in the basket. The Migros endpoint is upsert-with-
 * target-quantity semantics: quantity=0 removes, quantity=N replaces (not
 * increments). Used by add/update/remove tools below.
 */
async function setItemQuantity(
  productId: string,
  quantity: number,
  shoppingListId?: number
): Promise<string> {
  const listId = await resolveShoppingListId(shoppingListId);
  const data = (await api(
    "PUT",
    "/shopping-list/public/v3/items",
    {
      shoppingListId: listId,
      items: [{ id: productId, quantity, type: "PRODUCT" }],
    },
    { creds: credsFromEnv() }
  )) as BasketResponse;
  return formatBasket(data);
}

/**
 * Add a product to the basket. Sets the target quantity (default 1). If the
 * item is already present, the quantity is REPLACED, not incremented — the
 * underlying API is upsert-to-target. Use update_basket_quantity to set an
 * explicit total when you want increment-like semantics.
 */
export async function addToBasket(args: {
  productId: string;
  quantity?: number;
  shoppingListId?: number;
}): Promise<string> {
  const qty = args.quantity ?? 1;
  if (qty < 1) throw new Error("quantity must be >= 1 for add_to_basket; use remove_from_basket to delete");
  return setItemQuantity(args.productId, qty, args.shoppingListId);
}

/** Set an item's exact target quantity. */
export async function updateBasketQuantity(args: {
  productId: string;
  quantity: number;
  shoppingListId?: number;
}): Promise<string> {
  if (args.quantity < 0) throw new Error("quantity must be >= 0");
  return setItemQuantity(args.productId, args.quantity, args.shoppingListId);
}

/** Remove an item entirely (quantity 0). */
export async function removeFromBasket(args: {
  productId: string;
  shoppingListId?: number;
}): Promise<string> {
  return setItemQuantity(args.productId, 0, args.shoppingListId);
}

interface AddressEntry {
  uid: string;
  identity?: { firstName?: string; lastName?: string; title?: string };
  postalAddress?: {
    street?: string;
    streetNumber?: string;
    zipCode?: string;
    city?: string;
    country?: string;
  };
  isDelivery?: boolean;
  isBilling?: boolean;
  isContact?: boolean;
  default?: boolean;
}

type OrderStatus = "PENDING" | "DELIVERED" | "CANCELLED" | "ALL";

/**
 * Fetch the user's order history, paginated by status.
 * - status: PENDING (open), DELIVERED, CANCELLED, or ALL. Default: ALL.
 * - page: 0-based.
 */
export async function getOrders(args: { status?: OrderStatus; page?: number } = {}): Promise<string> {
  const status = args.status ?? "ALL";
  const page = args.page ?? 0;
  const data = (await api(
    "GET",
    `/ordergateway/public/web/v1/customers/customer-orders?status=${encodeURIComponent(status)}&page=${page}`,
    undefined,
    { creds: credsFromEnv() }
  )) as { orders?: unknown[]; numberOfOrders?: number; totalPages?: number; pageNumber?: number } | unknown[];

  // Endpoint may return either an envelope { orders, numberOfOrders, ... } or
  // a bare array depending on backend version. Normalize.
  const orders = Array.isArray(data) ? data : (data.orders ?? []);
  return JSON.stringify(
    {
      status,
      page,
      orderCount: orders.length,
      totalCount: Array.isArray(data) ? undefined : data.numberOfOrders,
      totalPages: Array.isArray(data) ? undefined : data.totalPages,
      orders,
      hint: orders.length === 0
        ? `No ${status === "ALL" ? "" : status.toLowerCase() + " "}orders on this page.`
        : "Use get_order_details with an order id to inspect a specific order.",
    },
    null,
    2
  );
}

/**
 * Returns the URL the user should open in their browser to review the basket
 * and complete checkout. Order placement requires payment confirmation in a
 * real browser (Datatrans 3DS / saved-card prompt), so we hand off rather than
 * try to automate the money step. Includes a basket summary for the LLM.
 */
export async function getCheckoutLink(): Promise<string> {
  const shoppingListId = await resolveShoppingListId();
  const data = (await api(
    "GET",
    `/shopping-list/public/v2/list/details?shoppingListId=${shoppingListId}`,
    undefined,
    { creds: credsFromEnv() }
  )) as BasketResponse;
  const items = (data.categories ?? []).flatMap((c) => c.items ?? []);
  if (items.length === 0) {
    return JSON.stringify(
      { ok: false, message: "Basket is empty. Add items with add_to_basket before checkout." },
      null,
      2
    );
  }
  const total = data.totals?.onlineTotal?.estimatedTotal;
  const minOk = data.totals?.onlineTotal?.minimumOrderValueReached ?? true;
  const freeDelivery = data.totals?.onlineTotal?.freeDelivery;
  return JSON.stringify(
    {
      ok: true,
      itemCount: items.length,
      onlineTotal: total,
      freeDelivery,
      minimumOrderValueReached: minOk,
      checkoutUrl: "https://www.migros.ch/en?context=ecommerce",
      message: minOk
        ? `Open the checkout URL in your browser to confirm address, delivery slot, and payment, then click "Place order".`
        : `Basket below minimum online order value. Add more items, then re-run get_checkout_link.`,
    },
    null,
    2
  );
}

/** Fetch the full details of one order by its id (numeric, e.g. from get_orders). */
export async function getOrderDetails(args: { orderId: string | number }): Promise<string> {
  const data = await api(
    "GET",
    `/ordergateway/public/web/v1/orders/${encodeURIComponent(String(args.orderId))}`,
    undefined,
    { creds: credsFromEnv() }
  );
  return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// Cumulus / in-store shopping
// ---------------------------------------------------------------------------

/**
 * Cumulus card status: points balance, level, cardholder, lifetime savings.
 * Useful as a "what's my Migros loyalty status" overview.
 */
export async function getCumulusStatus(): Promise<string> {
  const data = (await api(
    "GET",
    "/retentionapi/public/web/v1/customers/cumulus/details",
    undefined,
    { creds: credsFromEnv() }
  )) as Record<string, unknown>;

  // The exact field set varies; surface the common ones the LLM will care about.
  const owner = data.cumulusCardOwner as Record<string, unknown> | undefined;
  return JSON.stringify(
    {
      cumulusId: data.cumulusId,
      level: data.level ?? data.cumulusLevel,
      pointsBalance: data.periodToDatePointsBalance ?? data.pointsBalance,
      lifetimePoints: data.lifetimePoints ?? data.totalPoints,
      cardholder: owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() : undefined,
      cardholderTitle: owner?.title,
      raw: data, // keep raw for the LLM in case it wants other fields
    },
    null,
    2
  );
}

/**
 * List in-store receipts (Kassenbons) over a date range. Default range: last
 * 30 days. The supermarketOnly flag excludes online order invoices, so this
 * tool answers "what did I buy at the physical store?".
 */
export async function getInStoreReceipts(args: {
  startDate?: string;
  endDate?: string;
  limit?: number;
} = {}): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const startDate = args.startDate ?? thirtyDaysAgo;
  const endDate = args.endDate ?? today;
  const limit = args.limit ?? 50;

  const url =
    `/retentionapi/public/web/v1/receipts?startDate=${encodeURIComponent(startDate)}` +
    `&endDate=${encodeURIComponent(endDate)}` +
    `&supermarketOnly=true&limit=${limit}`;
  const data = await api("GET", url, undefined, { creds: credsFromEnv() });

  // Response may be an array or an envelope; normalize.
  const list = Array.isArray(data) ? data : (data as { receipts?: unknown[] }).receipts ?? [];
  return JSON.stringify(
    {
      startDate,
      endDate,
      count: list.length,
      receipts: list,
      hint: list.length > 0
        ? "Use get_receipt_details with a receipt id to inspect line items."
        : `No in-store receipts in ${startDate} to ${endDate}.`,
    },
    null,
    2
  );
}

/** Full line-item breakdown for one in-store receipt. */
export async function getReceiptDetails(args: { receiptId: string | number }): Promise<string> {
  const data = await api(
    "GET",
    `/retentionapi/public/web/v1/receipts/${encodeURIComponent(String(args.receiptId))}`,
    undefined,
    { creds: credsFromEnv() }
  );
  return JSON.stringify(data, null, 2);
}

/**
 * Active Cumulus coupons targeted at the user. Migros personalises these based
 * on shopping history — they typically expire after a few weeks.
 */
export async function getCumulusCoupons(): Promise<string> {
  // The SPA calls cumulus-coupons with a deliveryRequestKey when in checkout
  // context (filters to coupons valid for the active delivery). For a general
  // "what coupons do I have" view, omit the key — the server returns all.
  const data = await api(
    "GET",
    "/retentionapi/public/web/v1/cumulus-coupons",
    undefined,
    { creds: credsFromEnv() }
  );
  const list = Array.isArray(data) ? data : (data as { coupons?: unknown[] }).coupons ?? [];
  return JSON.stringify(
    {
      count: list.length,
      coupons: list,
      hint: list.length > 0
        ? "Each coupon has an id, discount, eligible products / categories, and expiry."
        : "No active personal coupons.",
    },
    null,
    2
  );
}

/**
 * Fetch the user's saved addresses (delivery + billing). Filtered server-side
 * by the deliveryOnly/billingOnly flags; we ask for both by default.
 */
export async function getAddresses(): Promise<string> {
  const list = (await api(
    "GET",
    "/retentionapi/public/web/v1/customers/addresses?deliveryOnly=false&billingOnly=false",
    undefined,
    { creds: credsFromEnv() }
  )) as AddressEntry[];

  return JSON.stringify(
    list.map((a) => ({
      uid: a.uid,
      name: [a.identity?.firstName, a.identity?.lastName].filter(Boolean).join(" "),
      address: [a.postalAddress?.street, a.postalAddress?.streetNumber].filter(Boolean).join(" "),
      city: [a.postalAddress?.zipCode, a.postalAddress?.city].filter(Boolean).join(" "),
      country: a.postalAddress?.country,
      delivery: !!a.isDelivery,
      billing: !!a.isBilling,
      default: !!a.default,
    })),
    null,
    2
  );
}
