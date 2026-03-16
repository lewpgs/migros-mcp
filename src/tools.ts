import {
  searchProducts as apiSearchProducts,
  getProductDetails as apiGetProductDetails,
  getCategories as apiGetCategories,
  searchStores as apiSearchStores,
  getPromotions as apiGetPromotions,
} from "./migros.js";

export async function searchProducts(
  query: string,
  language: string
): Promise<string> {
  const result = await apiSearchProducts(query, language);

  if (result.productIds.length === 0) {
    return JSON.stringify({
      message: `No products found for "${query}"`,
      numberOfProducts: 0,
      productIds: [],
    });
  }

  return JSON.stringify(
    {
      numberOfProducts: result.numberOfProducts,
      productIds: result.productIds,
      hint: "Use get_product_details with these product IDs to get full product info including nutrition, price, and ingredients.",
    },
    null,
    2
  );
}

function formatNutrition(product: Record<string, unknown>): string | null {
  const nutrients = product.nutrientsInformation as
    | { nutrientsTable?: { headers?: unknown[]; rows?: unknown[] } }
    | undefined;

  if (!nutrients?.nutrientsTable?.rows) return null;

  const table = nutrients.nutrientsTable;
  const headers = (table.headers as Array<{ label?: string; unit?: string }>) ?? [];
  const rows = (table.rows as Array<{ label?: string; values?: string[] }>) ?? [];

  if (rows.length === 0) return null;

  const headerLabels = headers.map(
    (h) => `${h.label ?? ""}${h.unit ? ` (${h.unit})` : ""}`
  );

  const lines: string[] = [];
  lines.push(`| Nutrient | ${headerLabels.join(" | ")} |`);
  lines.push(`|${"-|".repeat(headerLabels.length + 1)}`);

  for (const row of rows) {
    const values = (row.values ?? []).join(" | ");
    lines.push(`| ${row.label ?? ""} | ${values} |`);
  }

  return lines.join("\n");
}

function formatProduct(product: Record<string, unknown>): Record<string, unknown> {
  const p = product as Record<string, unknown>;

  const formatted: Record<string, unknown> = {
    uid: p.uid,
    name: p.name ?? p.title,
    brand: p.brand,
    brandLine: p.brandLine,
    description: p.description,
    origin: p.origin,
  };

  // Price
  const price = p.price as Record<string, unknown> | undefined;
  if (price) {
    formatted.price = {
      value: price.value,
      unitPrice: price.unitPrice,
      promotionalPrice: price.promotionalPrice,
    };
  }

  // Ratings
  const ratings = p.ratings as Record<string, unknown> | undefined;
  if (ratings) {
    formatted.ratings = {
      average: ratings.average,
      count: ratings.count,
    };
  }

  // Ingredients
  if (p.ingredients) {
    formatted.ingredients = p.ingredients;
  }

  // Allergens
  if (p.allergenText) {
    formatted.allergens = p.allergenText;
  }

  // Nutrition table (formatted as markdown)
  const nutritionTable = formatNutrition(product);
  if (nutritionTable) {
    formatted.nutrition = nutritionTable;
  }

  // Categories
  const categories = p.categories as Array<Record<string, unknown>> | undefined;
  if (categories && categories.length > 0) {
    formatted.categories = categories.map((c) => c.name ?? c.code).filter(Boolean);
  }

  // GTINs
  if (p.gtins) {
    formatted.gtins = p.gtins;
  }

  // Availability
  const availability = p.productAvailability as Record<string, unknown> | undefined;
  if (availability) {
    formatted.isAvailable = availability.isAvailable;
  }

  return formatted;
}

export async function getProductDetails(
  productIds: string[]
): Promise<string> {
  const products = await apiGetProductDetails(productIds);

  if (!products || (products as unknown[]).length === 0) {
    return JSON.stringify({
      message: "No product details found for the given IDs",
      productIds,
    });
  }

  const formatted = (products as Record<string, unknown>[]).map(formatProduct);

  return JSON.stringify(formatted, null, 2);
}

export async function getCategories(): Promise<string> {
  const categories = await apiGetCategories();
  return JSON.stringify(categories, null, 2);
}

export async function searchStores(query: string): Promise<string> {
  const stores = await apiSearchStores(query);

  if (!stores || stores.length === 0) {
    return JSON.stringify({
      message: `No stores found for "${query}"`,
    });
  }

  return JSON.stringify(stores, null, 2);
}

export async function getPromotions(query: string): Promise<string> {
  const items = await apiGetPromotions(query);
  return JSON.stringify(items, null, 2);
}
