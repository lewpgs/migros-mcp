import { defaultGet, getMigros, migrosHeaders, type Get } from "./http.js";

/**
 * The product category tree ("storemap"). Migros moved it from
 * /onesearch-oc-seaapi/public/v2/storemap, which migros-api-wrapper still
 * calls and which now answers 404 (checked 08.11.2026).
 */

const STOREMAP_PATH = "/product-display/public/v1/storemap";

export function storemapPath(language = "de"): string {
  const params = new URLSearchParams({
    language: /^[a-z]{2}$/.test(language) ? language : "de",
    regionId: "national",
    storeMapScope: "DEFAULT",
  });
  return `${STOREMAP_PATH}?${params.toString()}`;
}

/** The top-level categories, each with its subcategories as Migros sends them. */
export function categoriesFromStoremap(data: unknown): unknown[] {
  const categories = (data as { categories?: unknown } | null)?.categories;
  if (Array.isArray(categories)) return categories;
  return Array.isArray(data) ? data : [];
}

export async function fetchCategories(token: string, language = "de", get: Get = defaultGet): Promise<unknown[]> {
  const data = await getMigros(get, storemapPath(language), migrosHeaders(token, language));
  return categoriesFromStoremap(data);
}
