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
