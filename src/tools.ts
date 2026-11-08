import {
  searchProducts as apiSearchProducts,
  getProductDetails as apiGetProductDetails,
  getStock as apiGetStock,
  getCategories as apiGetCategories,
  searchStores as apiSearchStores,
  getPromotions as apiGetPromotions,
  searchRecipes as apiSearchRecipes,
  getRecipeDetails as apiGetRecipeDetails,
  getRecipeProducts as apiGetRecipeProducts,
  getOnlineProductCards as apiGetOnlineProductCards,
  isMigrosIdList,
} from "./migros.js";
import { uidsNeedingOnlinePrice } from "./online.js";

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

  const hint =
    "Use get_product_details with these product IDs to get full product info including nutrition, price, and ingredients.";
  if (!result.onlineOnlyProductIds?.length) {
    return JSON.stringify(
      {
        numberOfProducts: result.numberOfProducts,
        productIds: result.productIds,
        hint,
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      numberOfProducts: result.numberOfProducts,
      productIds: result.productIds,
      onlineOnlyProductIds: result.onlineOnlyProductIds,
      hint:
        hint +
        " onlineOnlyProductIds (also in productIds) were found only by the Migros Online shop search, " +
        "for example 'Partner' products. They can be delivered and added to the basket, but stores don't sell them, so get_stock won't find them.",
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
    migrosId: p.migrosId,
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

/**
 * What an online shop product card adds for an online-only product: its
 * online price, the Partner badge, availability and the website link.
 */
function onlineOffer(card: Record<string, unknown>): Record<string, unknown> {
  const fromCard = formatProduct(card);
  const out: Record<string, unknown> = {};
  for (const key of ["price", "unitPrice", "promoPrice", "quantity"]) {
    if (fromCard[key] !== undefined) out[key] = fromCard[key];
  }

  const offer = card.offer as Record<string, unknown> | undefined;
  const badges = (offer?.badges as Array<Record<string, unknown>> | undefined) ?? [];
  if (badges.some((b) => b?.type === "PARTNER")) {
    out.partner = true;
  }

  if (typeof card.productAvailability === "string") {
    out.availability = card.productAvailability;
  }

  const moId = card.migrosOnlineId;
  if (typeof moId === "string" || typeof moId === "number") {
    out.migrosOnlineId = String(moId);
    if (/^\d+$/.test(String(moId))) {
      out.url = `https://www.migros.ch/de/product/mo/${moId}`;
    }
  }
  return out;
}

/**
 * Add the online shop's price and badges to a product the in-store details
 * returned without a price. In-store availability doesn't apply to it.
 */
export function withOnlineOffer(
  formatted: Record<string, unknown>,
  card: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...formatted, ...onlineOffer(card) };
  if (out.availability !== undefined) delete out.isAvailable;
  return out;
}

/**
 * Shape a product card from the online shop like formatProduct does, for a
 * product the in-store details don't know at all. Cards carry no nutrition
 * or ingredients.
 */
export function formatOnlineCard(card: Record<string, unknown>): Record<string, unknown> {
  const formatted = withOnlineOffer(formatProduct(card), card);

  const breadcrumb = card.breadcrumb as Array<Record<string, unknown>> | undefined;
  if (!formatted.categories && breadcrumb?.length) {
    formatted.categories = breadcrumb.map((c) => c.name).filter(Boolean);
  }

  formatted.source = "Migros Online shop (no nutrition or ingredients for this product)";
  return formatted;
}

export async function getProductDetails(
  productIds: string[]
): Promise<string> {
  const products = ((await apiGetProductDetails(productIds)) ?? []) as Record<string, unknown>[];

  // Online-only products (e.g. "Partner") have no in-store price, or aren't
  // in the in-store details at all. Ask the online shop's product cards for
  // those. Products with an in-store price make no extra call.
  const needOnline = isMigrosIdList(productIds) ? [] : uidsNeedingOnlinePrice(productIds, products);
  const cards = (await apiGetOnlineProductCards(needOnline)) as Record<string, unknown>[];
  const cardByUid = new Map(cards.map((c) => [String(c.uid), c]));

  const formatted = products.map((p) => {
    const card = cardByUid.get(String(p.uid));
    if (!card) return formatProduct(p);
    cardByUid.delete(String(p.uid));
    return withOnlineOffer(formatProduct(p), card);
  });
  formatted.push(...[...cardByUid.values()].map(formatOnlineCard));

  if (formatted.length === 0) {
    return JSON.stringify({
      message: "No product details found for the given IDs",
      productIds,
    });
  }

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

// ---------------------------------------------------------------------------
// Recipes (Migusto)
// ---------------------------------------------------------------------------

export async function searchRecipes(args: {
  query?: string;
  ingredients?: string[];
  language?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  // Migusto only serves German, French, and Italian — no English content.
  const lang = (args.language && ["de", "fr", "it"].includes(args.language) ? args.language : "de") as "de" | "fr" | "it";

  const result = (await apiSearchRecipes({
    searchTerm: args.query,
    ingredients: args.ingredients,
    language: lang,
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
  })) as { total?: number; recipes?: Record<string, unknown>[] };

  const list = result.recipes ?? [];
  return JSON.stringify(
    {
      count: list.length,
      total: result.total,
      language: lang,
      recipes: list.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        durationTotal: r.durationTotal,
        rating: r.rating,
        teaser: r.teasertext,
        image: (r.images as Record<string, string> | undefined)?.["400w"],
        url: r.slug ? `https://migusto.migros.ch/${lang}/rezepte/${r.slug}` : undefined,
      })),
      hint:
        list.length > 0
          ? "Use get_recipe_details with a slug for ingredients + instructions. Use get_recipe_products with the recipe id (NOT slug) to get Migros product UIDs you can add to the basket."
          : "No recipes matched. Try different search terms. Note: Migusto only serves de/fr/it content.",
    },
    null,
    2
  );
}

export async function getRecipeDetails(args: { slug: string; language?: string }): Promise<string> {
  const result = await apiGetRecipeDetails({ slug: args.slug, language: args.language ?? "de" });
  return JSON.stringify(result, null, 2);
}

export async function getRecipeProducts(args: {
  recipeId: string;
  language?: string;
  limit?: number;
  offset?: number;
}): Promise<string> {
  const result = await apiGetRecipeProducts({
    id: args.recipeId,
    language: args.language ?? "de",
    limit: args.limit ?? 50,
    offset: args.offset ?? 0,
  });
  return JSON.stringify(result, null, 2);
}
