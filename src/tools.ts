import {
  searchProducts as apiSearchProducts,
  getProductDetails as apiGetProductDetails,
  getStock as apiGetStock,
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
  const productInfo = product.productInformation as Record<string, unknown> | undefined;
  const nutrients = (productInfo?.nutrientsInformation ?? product.nutrientsInformation) as
    | { nutrientsTable?: { headers?: unknown[]; rows?: unknown[] } }
    | undefined;

  if (!nutrients?.nutrientsTable?.rows) return null;

  const table = nutrients.nutrientsTable;
  const headers = (table.headers as Array<{ label?: string; unit?: string }>) ?? [];
  const rows = (table.rows as Array<{ label?: string; values?: string[] }>) ?? [];

  if (rows.length === 0) return null;

  // Headers can be strings or objects with label/unit
  const headerLabels = headers.map((h) => {
    if (typeof h === "string") return h;
    return `${h.label ?? ""}${h.unit ? ` (${h.unit})` : ""}`;
  });

  const lines: string[] = [];
  lines.push(`| Nutrient | ${headerLabels.join(" | ")} |`);
  lines.push(`| --- | ${headerLabels.map(() => "---").join(" | ")} |`);

  for (const row of rows) {
    const values = (row.values ?? []).join(" | ");
    lines.push(`| ${row.label ?? ""} | ${values} |`);
  }

  return lines.join("\n");
}

function formatProduct(product: Record<string, unknown>): Record<string, unknown> {
  const p = product as Record<string, unknown>;
  const productInfo = p.productInformation as Record<string, unknown> | undefined;
  const mainInfo = productInfo?.mainInformation as Record<string, unknown> | undefined;

  // Brand can be top-level or nested in mainInformation
  const brandInfo = mainInfo?.brand as Record<string, unknown> | undefined;
  const brand = p.brand ?? brandInfo?.name;

  const formatted: Record<string, unknown> = {
    uid: p.uid,
    name: p.name ?? p.title,
    brand: brand,
    versioning: p.versioning,
    description: p.description,
  };

  // Price info (under offer.price)
  const offer = p.offer as Record<string, unknown> | undefined;
  const offerPrice = offer?.price as Record<string, unknown> | undefined;
  if (offerPrice) {
    formatted.price = `CHF ${offerPrice.advertisedDisplayValue}`;
    const unitPrice = offerPrice.unitPrice as Record<string, unknown> | undefined;
    if (unitPrice) {
      formatted.unitPrice = `CHF ${unitPrice.value}/${unitPrice.unit}`;
    }
  }
  // Promotional price
  const promoPrice = offer?.promotionPrice as Record<string, unknown> | undefined;
  if (promoPrice?.advertisedDisplayValue) {
    formatted.promoPrice = `CHF ${promoPrice.advertisedDisplayValue}`;
  }
  if (offer?.quantity) {
    formatted.quantity = offer.quantity;
  }

  // Ratings
  const rating = mainInfo?.rating as Record<string, unknown> | undefined;
  const ratings = (rating ?? p.ratings) as Record<string, unknown> | undefined;
  if (ratings) {
    formatted.ratings = {
      average: ratings.nbStars ?? ratings.average,
      count: ratings.nbReviews ?? ratings.count,
    };
  }

  // Ingredients
  const ingredients = mainInfo?.ingredients ?? p.ingredients;
  if (ingredients) {
    // Strip HTML tags
    formatted.ingredients = (ingredients as string).replace(/<[^>]*>/g, "");
  }

  // Allergens
  const allergens = mainInfo?.allergens ?? mainInfo?.allergenIndication ?? p.allergenText;
  if (allergens) {
    formatted.allergens = allergens;
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

export async function getStock(
  productId: string,
  storeId: string
): Promise<string> {
  const result = await apiGetStock(productId, storeId);

  if (result.stock === null) {
    return JSON.stringify({
      productId,
      storeId,
      inStock: false,
      message: "Product not available at this store or stock data unavailable.",
    });
  }

  return JSON.stringify({
    productId,
    storeId,
    inStock: result.stock > 0,
    stock: result.stock,
    note: "Stock is updated once a day and is approximate.",
  });
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
