import { MigrosAPI } from "migros-api-wrapper";

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
    const result = await migros.products.productDisplay.getProductDetails(
      { uids: productIds } as any,
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
