import { MigrosAPI } from "migros-api-wrapper";

const migros = new MigrosAPI();
// Migusto (recipes) is exposed as a static on MigrosAPI, not on the instance.
const migusto = MigrosAPI.migusto;

let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) {
    return cachedToken;
  }

  const result = await migros.account.oauth2.loginGuestToken();
  cachedToken = result.token as string;
  return cachedToken!;
}

/**
 * Reset the cached token so the next call fetches a fresh one.
 * Useful if a request fails due to token expiry.
 */
function clearToken(): void {
  cachedToken = null;
}

/**
 * Wrapper that retries once with a fresh token on failure.
 */
async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  try {
    const token = await getToken();
    return await fn(token);
  } catch (error) {
    // Token might have expired, try once more with a fresh one
    clearToken();
    const token = await getToken();
    return await fn(token);
  }
}

export async function searchProducts(
  query: string,
  language: string
): Promise<{ productIds: string[]; numberOfProducts: number }> {
  return withToken(async (token) => {
    const result = await migros.products.productSearch.searchProduct(
      { query, language: language as any },
      {},
      token
    );
    return {
      productIds: result.productIds ?? [],
      numberOfProducts: result.numberOfProducts ?? 0,
    };
  });
}

export async function getProductDetails(
  productIds: string[]
): Promise<unknown[]> {
  return withToken(async (token) => {
    // Detect if IDs are migrosIds (long numeric, 12+ digits) or uids (shorter numeric)
    const isMigrosId = productIds.every((id) => id.length >= 12 && /^\d+$/.test(id));
    const params = isMigrosId
      ? { migrosIds: productIds.join(",") }
      : { uids: productIds };
    const result = await migros.products.productDisplay.getProductDetails(
      params as any,
      token
    );
    return result ?? [];
  });
}

export async function getStock(
  productId: string,
  storeId: string
): Promise<{ catalogItemId: string; stock: number | null }> {
  return withToken(async (token) => {
    const result = await migros.products.productStock.getProductSupply(
      { pids: productId, costCenterIds: storeId } as any,
      token
    );
    const avail = (result?.availabilities as Array<{ id: string; stock: number }>) ?? [];
    const match = avail.find((a) => a.id === storeId);
    return {
      catalogItemId: result?.catalogItemId ?? productId,
      stock: match?.stock ?? null,
    };
  });
}

export async function getCategories(): Promise<unknown> {
  return withToken(async (token) => {
    const result = await migros.products.productSearch.categoryList({}, token);
    return result?.categories ?? [];
  });
}

export async function searchStores(query: string): Promise<unknown[]> {
  return withToken(async (token) => {
    const result = await migros.stores.searchStores({ query }, token);
    return result ?? [];
  });
}

export async function getPromotions(query: string): Promise<unknown> {
  return withToken(async (token) => {
    const result =
      await migros.products.productDisplay.getProductPromotionSearch(
        { query },
        token
      );
    return result?.items ?? [];
  });
}

// ---------------------------------------------------------------------------
// Migusto (recipes) — public, no auth required
// ---------------------------------------------------------------------------

export async function searchRecipes(args: {
  searchTerm?: string;
  ingredients?: string[];
  language?: string;
  limit?: number;
  offset?: number;
}): Promise<unknown> {
  // Only include fields that are actually set; the underlying wrapper
  // mis-encodes the request when given explicit `undefined` values.
  const opts: Record<string, unknown> = {
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
  };
  if (args.searchTerm) opts.searchTerm = args.searchTerm;
  if (args.ingredients?.length) opts.ingredients = args.ingredients;
  if (args.language) opts.language = args.language;
  return await migusto.recipeSearch(opts as any);
}

export async function getRecipeDetails(args: {
  slug: string;
  language?: string;
}): Promise<unknown> {
  const opts: Record<string, unknown> = { slug: args.slug };
  if (args.language) opts.language = args.language;
  return await migusto.recipeDetails(opts as any);
}

export async function getRecipeProducts(args: {
  id: string;
  language?: string;
  limit?: number;
  offset?: number;
}): Promise<unknown> {
  const opts: Record<string, unknown> = {
    id: args.id,
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  };
  if (args.language) opts.language = args.language;
  return await migusto.recipeProducts(opts as any);
}
