#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { register } from "./register.js";
import {
  SearchProductsSchema,
  GetProductDetailsSchema,
  GetStockSchema,
  SearchStoresSchema,
  GetPromotionsSchema,
  SearchRecipesSchema,
  GetRecipeDetailsSchema,
  GetRecipeProductsSchema,
  GetBasketSchema,
  AddToBasketSchema,
  UpdateBasketQuantitySchema,
  RemoveFromBasketSchema,
  GetOrdersSchema,
  GetOrderDetailsSchema,
  GetInStoreReceiptsSchema,
  GetReceiptDetailsSchema,
} from "./schemas.js";
import {
  searchProducts,
  getProductDetails,
  getStock,
  getCategories,
  searchStores,
  getPromotions,
  searchRecipes,
  getRecipeDetails,
  getRecipeProducts,
} from "./tools.js";
import {
  getProfile,
  getBasket,
  addToBasket,
  updateBasketQuantity,
  removeFromBasket,
  getAddresses,
  getOrders,
  getOrderDetails,
  getCheckoutLink,
  getCumulusStatus,
  getInStoreReceipts,
  getReceiptDetails,
  getCumulusCoupons,
} from "./auth-tools.js";

// ---------------------------------------------------------------------------
// Server + tool registrations
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "migros-mcp", version: "0.3.0" });

// --- Anonymous: search & browse ---

register(server, "search_products",
  "Search Migros products by name or keyword. Returns product IDs that can be used with get_product_details.",
  SearchProductsSchema.shape, ({ query, language }) => searchProducts(query, language ?? "de"));

register(server, "get_product_details",
  "Get full product details including nutrition facts, ingredients, allergens, price, and ratings. Use search_products first to get product IDs.",
  GetProductDetailsSchema.shape, ({ productIds }) => getProductDetails(productIds));

register(server, "get_stock",
  "Check product stock at a specific Migros store. Use search_products and search_stores first to get the IDs. Stock is approximate and updated once a day.",
  GetStockSchema.shape, ({ productId, storeId }) => getStock(productId, storeId));

register(server, "get_categories",
  "List all Migros product categories",
  {}, () => getCategories());

register(server, "search_stores",
  "Find Migros stores by location (city name, zip code, etc.). Returns store details including address and opening hours.",
  SearchStoresSchema.shape, ({ query }) => searchStores(query));

register(server, "get_promotions",
  "Search current Migros promotions and deals. Optionally filter by search query.",
  GetPromotionsSchema.shape, ({ query }) => getPromotions(query ?? ""));

// --- Anonymous: recipes (Migusto) ---

register(server, "search_recipes",
  "Search Migusto (Migros' recipe site) by free-text query and/or ingredients. Returns recipe id, slug, title, cooking time, rating. Use get_recipe_details for full info or get_recipe_products to get Migros product UIDs to add to the basket.",
  SearchRecipesSchema.shape, (args) => searchRecipes(args));

register(server, "get_recipe_details",
  "Fetch a full recipe by slug: ingredients with quantities, step-by-step instructions, photos, nutrition. Use search_recipes first to find the slug.",
  GetRecipeDetailsSchema.shape, (args) => getRecipeDetails(args));

register(server, "get_recipe_products",
  "Fetch the Migros products needed for a recipe — returns product UIDs you can pass directly to add_to_basket. Bridges recipes to shopping. Use the recipe ID from search_recipes (NOT the slug).",
  GetRecipeProductsSchema.shape, (args) => getRecipeProducts(args));

// --- Authenticated: account ---

register(server, "get_profile",
  "Get the logged-in customer's basic profile (name, email, language, cooperative). Requires authentication.",
  {}, () => getProfile());

register(server, "get_addresses",
  "Get the user's saved delivery and billing addresses. Requires authentication.",
  {}, () => getAddresses());

// --- Authenticated: cart ---

register(server, "get_basket",
  "Fetch the items currently in the user's shopping basket (Migros calls this a shopping list). Returns product IDs and quantities; use get_product_details to enrich. Requires authentication.",
  GetBasketSchema.shape, (args) => getBasket(args));

register(server, "add_to_basket",
  "Add a product to the user's basket (or set its quantity if already present). The underlying API is upsert-to-target, not increment. Returns the updated basket. Requires authentication.",
  AddToBasketSchema.shape, (args) => addToBasket(args));

register(server, "update_basket_quantity",
  "Set an item's exact quantity in the basket. quantity=0 removes the item. Returns the updated basket. Requires authentication.",
  UpdateBasketQuantitySchema.shape, (args) => updateBasketQuantity(args));

register(server, "remove_from_basket",
  "Remove a product from the user's basket. Returns the updated basket. Requires authentication.",
  RemoveFromBasketSchema.shape, (args) => removeFromBasket(args));

// --- Authenticated: orders ---

register(server, "get_orders",
  "List the user's online orders, paginated, filtered by status. Use to find an order id, then call get_order_details. Requires authentication.",
  GetOrdersSchema.shape, (args) => getOrders(args));

register(server, "get_order_details",
  "Fetch the full details of a single order by id. Requires authentication.",
  GetOrderDetailsSchema.shape, (args) => getOrderDetails(args));

register(server, "get_checkout_link",
  "Return the URL the user should open in their browser to complete checkout (review basket, confirm address/slot, pay). Order placement requires payment confirmation in a real browser, so this tool hands off rather than firing the order automatically. Returns a basket summary alongside the URL. Requires authentication.",
  {}, () => getCheckoutLink());

// --- Authenticated: Cumulus / in-store ---

register(server, "get_cumulus_status",
  "Get the user's Cumulus loyalty card status: points balance, level, cardholder, lifetime stats. Requires authentication.",
  {}, () => getCumulusStatus());

register(server, "get_in_store_receipts",
  "List the user's in-store Migros receipts (Kassenbons) over a date range. Default: last 30 days. Use get_receipt_details with an id for line items. Requires authentication.",
  GetInStoreReceiptsSchema.shape, (args) => getInStoreReceipts(args));

register(server, "get_receipt_details",
  "Get the URL to view a single in-store receipt's line items in the browser. Line items aren't accessible via the API — get_in_store_receipts gives store/date/amount/points which is enough for most queries. Requires authentication.",
  GetReceiptDetailsSchema.shape, (args) => getReceiptDetails(args));

register(server, "get_cumulus_coupons",
  "List active Cumulus coupons targeted at the user (personalized offers based on shopping history). Requires authentication.",
  {}, () => getCumulusCoupons());

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
