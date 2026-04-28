import { z } from "zod";

// ---------------------------------------------------------------------------
// Anonymous: products, stores, promotions
// ---------------------------------------------------------------------------

export const SearchProductsSchema = z.object({
  query: z.string().describe("Search query for Migros products"),
  language: z
    .string()
    .optional()
    .default("de")
    .describe("Language for results (de, fr, it, en). Default: de"),
});

export const GetProductDetailsSchema = z.object({
  productIds: z
    .array(z.string())
    .describe("Array of product IDs (UIDs) to get details for. Get these from search_products first."),
});

export const SearchStoresSchema = z.object({
  query: z.string().describe("Search query for Migros stores (city name, zip code, etc.)"),
});

export const GetStockSchema = z.object({
  productId: z.string().describe("Product UID to check stock for. Get this from search_products."),
  storeId: z.string().describe("Store ID (costCenterId) to check stock at. Get this from search_stores."),
});

export const GetPromotionsSchema = z.object({
  query: z.string().optional().default("").describe("Optional search query to filter promotions"),
});

// ---------------------------------------------------------------------------
// Anonymous: recipes (Migusto)
// ---------------------------------------------------------------------------

export const SearchRecipesSchema = z.object({
  query: z.string().optional().describe("Free-text search term, e.g. 'pasta carbonara'."),
  ingredients: z.array(z.string()).optional().describe("Filter to recipes that use these ingredients."),
  language: z.string().optional().describe("Language code: de, fr, it. Default: de."),
  limit: z.number().int().min(1).max(50).optional().describe("Max recipes to return. Default: 20."),
  offset: z.number().int().min(0).optional().describe("0-based offset for pagination."),
});

export const GetRecipeDetailsSchema = z.object({
  slug: z.string().describe("Recipe slug from search_recipes (the URL-safe id)."),
  language: z.string().optional().describe("Language code. Default: de."),
});

export const GetRecipeProductsSchema = z.object({
  recipeId: z.string().describe("Recipe id (UUID) from search_recipes. NOT the slug."),
  language: z.string().optional().describe("Language code. Default: de."),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Authenticated: cart
// ---------------------------------------------------------------------------

export const GetBasketSchema = z.object({
  shoppingListId: z.number().optional().describe("Optional shopping list ID. Omit to fetch the user's primary list."),
});

export const AddToBasketSchema = z.object({
  productId: z.string().describe("Product UID from search_products (e.g. '100049709')."),
  quantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Target quantity. Defaults to 1. REPLACES existing quantity, not increment."),
  shoppingListId: z.number().optional().describe("Optional list ID; omit to use the primary list."),
});

export const UpdateBasketQuantitySchema = z.object({
  productId: z.string().describe("Product UID."),
  quantity: z.number().int().min(0).describe("Exact target quantity. 0 removes the item."),
  shoppingListId: z.number().optional(),
});

export const RemoveFromBasketSchema = z.object({
  productId: z.string().describe("Product UID to remove from the basket."),
  shoppingListId: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Authenticated: orders
// ---------------------------------------------------------------------------

export const GetOrdersSchema = z.object({
  status: z
    .enum(["PENDING", "DELIVERED", "CANCELLED", "ALL"])
    .optional()
    .describe("Filter by order status. Default: ALL."),
  page: z.number().int().min(0).optional().describe("0-based page number. Default: 0."),
});

export const GetOrderDetailsSchema = z.object({
  orderId: z.union([z.string(), z.number()]).describe("Order id (numeric). Get from get_orders."),
});

// ---------------------------------------------------------------------------
// Authenticated: Cumulus / in-store
// ---------------------------------------------------------------------------

export const GetInStoreReceiptsSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Start date YYYY-MM-DD. Default: 30 days ago."),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("End date YYYY-MM-DD. Default: today."),
  limit: z.number().int().min(1).max(500).optional().describe("Max receipts to return. Default: 50."),
});

export const GetReceiptDetailsSchema = z.object({
  receiptId: z.union([z.string(), z.number()]).describe("Receipt id from get_in_store_receipts."),
});
