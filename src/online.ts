import { defaultPost, migrosHeaders, postMigros, type Post } from "./http.js";

export type { Post };

/**
 * The Migros Online (home delivery) catalogue.
 *
 * The search in migros-api-wrapper only covers what's sold in stores. Some
 * products exist only in the online shop, for example "Partner" products
 * that are delivered but never stocked in a store (issue #8). The website
 * finds those with a separate search when it is in "order online" mode, and
 * loads their price and name from product cards for the online channel.
 * Both calls are anonymous and take the same guest token as the wrapper.
 */

const SEARCH_PATH = "/product-display/public/v2/products/search";
const CARDS_PATH = "/product-display/public/v4/product-cards";

/**
 * Online stock and prices depend on a delivery warehouse. Without a delivery
 * address the website picks one from the language: Zürich (2) for German
 * and Italian, Lausanne and Geneva (1) for French and English.
 */
const WAREHOUSE_BY_LANGUAGE: Record<string, number> = { de: 2, it: 2, fr: 1, en: 1 };
const DEFAULT_WAREHOUSE = 2;

export function onlineWarehouseId(language?: string): number {
  return WAREHOUSE_BY_LANGUAGE[language ?? ""] ?? DEFAULT_WAREHOUSE;
}

/** Same body the website sends for a search in "order online" mode. */
export function onlineSearchBody(query: string, language: string): Record<string, unknown> {
  return {
    query,
    language,
    storeType: "ONLINE",
    warehouseId: onlineWarehouseId(language),
    sortFields: [],
    sortOrder: "asc",
    from: 0,
    limit: 100,
    filters: {},
    searchAlgorithm: "DEFAULT",
    enabledSponsoredProducts: false,
  };
}

/** Product uids from an online search response, in the order given. */
export function productIdsFromOnlineSearch(data: unknown): string[] {
  const items = (data as { items?: Array<{ id?: unknown; type?: unknown }> } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i?.type === "PRODUCT" && (typeof i.id === "number" || typeof i.id === "string"))
    .map((i) => String(i.id));
}

/** Same body the website sends for product cards in "order online" mode. */
export function onlineCardsBody(uids: string[], today: Date = new Date()): Record<string, unknown> {
  return {
    offerFilter: {
      storeType: "ONLINE",
      warehouseId: DEFAULT_WAREHOUSE,
      ongoingOfferDate: today.toISOString().split("T")[0] + "T00:00:00",
    },
    productFilter: { uids: uids.map((id) => Number(id)) },
  };
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** Search the online shop. Returns product uids. Throws on a non-2xx answer. */
export async function searchOnline(
  query: string,
  language: string,
  token: string,
  post: Post = defaultPost
): Promise<string[]> {
  const data = await postMigros(post, SEARCH_PATH, onlineSearchBody(query, language), migrosHeaders(token, language));
  return productIdsFromOnlineSearch(data);
}

/** Product cards (name, brand, price, badges) from the online shop. Throws on a non-2xx answer. */
export async function getOnlineCards(uids: string[], token: string, post: Post = defaultPost): Promise<unknown[]> {
  const numeric = uids.filter((id) => /^\d+$/.test(id));
  if (numeric.length === 0) return [];
  const data = await postMigros(post, CARDS_PATH, onlineCardsBody(numeric), migrosHeaders(token));
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
// Merging with the in-store results
// ---------------------------------------------------------------------------

export interface SearchResult {
  productIds: string[];
  numberOfProducts: number;
  /** Ids only the online shop search found (partner products among them). */
  onlineOnlyProductIds?: string[];
}

/**
 * Add the online search's ids that the in-store search didn't return, after
 * the in-store ones. With nothing new, the in-store result comes back as it was.
 */
export function mergeSearchResults(store: SearchResult, onlineIds: string[]): SearchResult {
  const seen = new Set(store.productIds.map(String));
  const extra: string[] = [];
  for (const id of onlineIds) {
    if (!seen.has(id)) {
      seen.add(id);
      extra.push(id);
    }
  }
  if (extra.length === 0) return store;
  return {
    productIds: [...store.productIds, ...extra],
    numberOfProducts: store.numberOfProducts + extra.length,
    onlineOnlyProductIds: extra,
  };
}

/**
 * Requested uids that need the online shop for their price: the in-store
 * details either didn't return them, or returned them without a price (an
 * online-only product has no in-store offer, checked live on 08.11.2026).
 */
export function uidsNeedingOnlinePrice(requested: string[], details: unknown[]): string[] {
  const priced = new Set<string>();
  for (const d of details) {
    const p = d as { uid?: unknown; offer?: { price?: unknown } } | null;
    if (p?.uid !== undefined && p.uid !== null && p.offer?.price) priced.add(String(p.uid));
  }
  return [...new Set(requested)].filter((id) => /^\d+$/.test(id) && !priced.has(id));
}
