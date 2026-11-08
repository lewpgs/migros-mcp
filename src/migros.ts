import { MigrosAPI } from "migros-api-wrapper";
import { getOnlineCards, mergeSearchResults, searchOnline, type SearchResult } from "./online.js";
import { fetchCategories } from "./categories.js";
import {
  checkRecipeId,
  fetchMigustoRecipe,
  fetchRecipe,
  searchRecipesRequest,
  type MigustoRecipe,
  type RecipeLanguage,
  type RecipeSearchArgs,
  type RecipeSummary,
} from "./recipes.js";

const migros = new MigrosAPI();

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

/**
 * Search the in-store catalogue (as before) and the online shop at the same
 * time. Online-only products, such as "Partner" products, come after the
 * in-store results (issue #8). If the online search fails, the in-store
 * result is returned unchanged.
 */
export async function searchProducts(
  query: string,
  language: string
): Promise<SearchResult> {
  return withToken(async (token) => {
    const [result, onlineIds] = await Promise.all([
      migros.products.productSearch.searchProduct(
        { query, language: language as any },
        {},
        token
      ),
      searchOnline(query, language, token).catch(() => [] as string[]),
    ]);
    return mergeSearchResults(
      {
        productIds: result.productIds ?? [],
        numberOfProducts: result.numberOfProducts ?? 0,
      },
      onlineIds
    );
  });
}

/** Ids that are migrosIds (12+ digits) rather than uids. */
export function isMigrosIdList(productIds: string[]): boolean {
  return productIds.every((id) => id.length >= 12 && /^\d+$/.test(id));
}

/**
 * Product cards from the online shop, for uids the in-store details don't
 * know (online-only products). Returns [] if the call fails. No retry with a
 * new token: the details call just before has already checked the token.
 */
export async function getOnlineProductCards(uids: string[]): Promise<unknown[]> {
  if (uids.length === 0) return [];
  try {
    return await getOnlineCards(uids, await getToken());
  } catch {
    return [];
  }
}

export async function getProductDetails(
  productIds: string[]
): Promise<unknown[]> {
  return withToken(async (token) => {
    // Detect if IDs are migrosIds (long numeric, 12+ digits) or uids (shorter numeric)
    const isMigrosId = isMigrosIdList(productIds);
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

/** The wrapper's categoryList() calls an address Migros removed, so this has its own request. */
export async function getCategories(): Promise<unknown[]> {
  return withToken((token) => fetchCategories(token, "de"));
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
// Recipes: migros.ch recipe API (search, by id) and Migusto pages (by slug).
// The wrapper's Migusto calls hit an API Migusto removed, see recipes.ts.
// ---------------------------------------------------------------------------

export async function searchRecipes(
  args: RecipeSearchArgs,
  language: RecipeLanguage
): Promise<{ total?: number; recipes: RecipeSummary[] }> {
  return withToken((token) => searchRecipesRequest(args, language, token));
}

export async function getRecipe(id: string, language: RecipeLanguage): Promise<Record<string, unknown>> {
  const recipeId = checkRecipeId(id); // before any request, so a bad id costs nothing
  return withToken((token) => fetchRecipe(recipeId, language, token));
}

/** No token: the Migusto recipe page is a public web page. */
export async function getRecipeDetails(slug: string, language: RecipeLanguage): Promise<MigustoRecipe> {
  return fetchMigustoRecipe(slug, language);
}
