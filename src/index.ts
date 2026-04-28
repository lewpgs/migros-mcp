#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SearchProductsSchema,
  GetProductDetailsSchema,
  GetStockSchema,
  SearchStoresSchema,
  GetPromotionsSchema,
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
import { z } from "zod";

const GetBasketSchema = z.object({
  shoppingListId: z
    .number()
    .optional()
    .describe("Optional shopping list ID. Omit to fetch the user's primary list."),
});

const AddToBasketSchema = z.object({
  productId: z.string().describe("Product UID from search_products (e.g. '100049709')."),
  quantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Target quantity. Defaults to 1. Note: this REPLACES any existing quantity, it does not increment."),
  shoppingListId: z.number().optional().describe("Optional list ID; omit to use the primary list."),
});

const UpdateBasketQuantitySchema = z.object({
  productId: z.string().describe("Product UID."),
  quantity: z.number().int().min(0).describe("Exact target quantity. 0 removes the item."),
  shoppingListId: z.number().optional(),
});

const RemoveFromBasketSchema = z.object({
  productId: z.string().describe("Product UID to remove from the basket."),
  shoppingListId: z.number().optional(),
});

const GetOrdersSchema = z.object({
  status: z
    .enum(["PENDING", "DELIVERED", "CANCELLED", "ALL"])
    .optional()
    .describe("Filter by order status. Default: ALL."),
  page: z.number().int().min(0).optional().describe("0-based page number. Default: 0."),
});

const GetOrderDetailsSchema = z.object({
  orderId: z
    .union([z.string(), z.number()])
    .describe("Order id (numeric). Get from get_orders."),
});

const GetInStoreReceiptsSchema = z.object({
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

const GetReceiptDetailsSchema = z.object({
  receiptId: z
    .union([z.string(), z.number()])
    .describe("Receipt id from get_in_store_receipts."),
});

const SearchRecipesSchema = z.object({
  query: z.string().optional().describe("Free-text search term, e.g. 'pasta carbonara'."),
  ingredients: z.array(z.string()).optional().describe("Filter to recipes that use these ingredients."),
  language: z.string().optional().describe("Language code: de, fr, it, en. Default: de."),
  limit: z.number().int().min(1).max(50).optional().describe("Max recipes to return. Default: 20."),
  offset: z.number().int().min(0).optional().describe("0-based offset for pagination."),
});

const GetRecipeDetailsSchema = z.object({
  slug: z.string().describe("Recipe slug from search_recipes (the URL-safe id)."),
  language: z.string().optional().describe("Language code. Default: de."),
});

const GetRecipeProductsSchema = z.object({
  recipeId: z.string().describe("Recipe id (UUID) from search_recipes. NOT the slug."),
  language: z.string().optional().describe("Language code. Default: de."),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const server = new McpServer({
  name: "migros-mcp",
  version: "0.3.0",
});

// --- Tools ---

server.tool(
  "search_products",
  "Search Migros products by name or keyword. Returns product IDs that can be used with get_product_details.",
  SearchProductsSchema.shape,
  async ({ query, language }) => {
    try {
      const result = await searchProducts(query, language ?? "de");
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_product_details",
  "Get full product details including nutrition facts, ingredients, allergens, price, and ratings. Use search_products first to get product IDs.",
  GetProductDetailsSchema.shape,
  async ({ productIds }) => {
    try {
      const result = await getProductDetails(productIds);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_stock",
  "Check product stock at a specific Migros store. Use search_products and search_stores first to get the IDs. Stock is approximate and updated once a day.",
  GetStockSchema.shape,
  async ({ productId, storeId }) => {
    try {
      const result = await getStock(productId, storeId);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_categories",
  "List all Migros product categories",
  {},
  async () => {
    try {
      const result = await getCategories();
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "search_stores",
  "Find Migros stores by location (city name, zip code, etc.). Returns store details including address and opening hours.",
  SearchStoresSchema.shape,
  async ({ query }) => {
    try {
      const result = await searchStores(query);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_promotions",
  "Search current Migros promotions and deals. Optionally filter by search query.",
  GetPromotionsSchema.shape,
  async ({ query }) => {
    try {
      const result = await getPromotions(query ?? "");
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "search_recipes",
  "Search Migusto (Migros' recipe site) by free-text query and/or ingredients. Returns recipe id, slug, title, cooking time, difficulty. Use get_recipe_details for full info or get_recipe_products to get Migros product UIDs to add to the basket.",
  SearchRecipesSchema.shape,
  async ({ query, ingredients, language, limit, offset }) => {
    try {
      const result = await searchRecipes({ query, ingredients, language, limit, offset });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_recipe_details",
  "Fetch a full recipe by slug: ingredients with quantities, step-by-step instructions, photos, nutrition. Use search_recipes first to find the slug.",
  GetRecipeDetailsSchema.shape,
  async ({ slug, language }) => {
    try {
      const result = await getRecipeDetails({ slug, language });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_recipe_products",
  "Fetch the Migros products needed for a recipe — returns product UIDs you can pass directly to add_to_basket. Bridges recipes to shopping. Use the recipe ID from search_recipes (NOT the slug).",
  GetRecipeProductsSchema.shape,
  async ({ recipeId, language, limit, offset }) => {
    try {
      const result = await getRecipeProducts({ recipeId, language, limit, offset });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

// --- Authenticated tools ---
// Require a logged-in user session. See README for setup (env vars or cookie cache).

server.tool(
  "get_profile",
  "Get the logged-in customer's basic profile (name, email, language, cooperative). Requires authentication.",
  {},
  async () => {
    try {
      const result = await getProfile();
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_basket",
  "Fetch the items currently in the user's shopping basket (Migros calls this a shopping list). Returns product IDs and quantities; use get_product_details to enrich. Requires authentication.",
  GetBasketSchema.shape,
  async ({ shoppingListId }) => {
    try {
      const result = await getBasket({ shoppingListId });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "add_to_basket",
  "Add a product to the user's basket (or set its quantity if already present). The underlying API is upsert-to-target, not increment. Returns the updated basket. Requires authentication.",
  AddToBasketSchema.shape,
  async ({ productId, quantity, shoppingListId }) => {
    try {
      const result = await addToBasket({ productId, quantity, shoppingListId });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "update_basket_quantity",
  "Set an item's exact quantity in the basket. quantity=0 removes the item. Returns the updated basket. Requires authentication.",
  UpdateBasketQuantitySchema.shape,
  async ({ productId, quantity, shoppingListId }) => {
    try {
      const result = await updateBasketQuantity({ productId, quantity, shoppingListId });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "remove_from_basket",
  "Remove a product from the user's basket. Returns the updated basket. Requires authentication.",
  RemoveFromBasketSchema.shape,
  async ({ productId, shoppingListId }) => {
    try {
      const result = await removeFromBasket({ productId, shoppingListId });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_addresses",
  "Get the user's saved delivery and billing addresses. Requires authentication.",
  {},
  async () => {
    try {
      const result = await getAddresses();
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_orders",
  "List the user's online orders, paginated, filtered by status. Use to find an order id, then call get_order_details. Requires authentication.",
  GetOrdersSchema.shape,
  async ({ status, page }) => {
    try {
      const result = await getOrders({ status, page });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_order_details",
  "Fetch the full details of a single order by id. Requires authentication.",
  GetOrderDetailsSchema.shape,
  async ({ orderId }) => {
    try {
      const result = await getOrderDetails({ orderId });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_checkout_link",
  "Return the URL the user should open in their browser to complete checkout (review basket, confirm address/slot, pay). Order placement requires payment confirmation in a real browser, so this tool hands off rather than firing the order automatically. Returns a basket summary alongside the URL. Requires authentication.",
  {},
  async () => {
    try {
      const result = await getCheckoutLink();
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_cumulus_status",
  "Get the user's Cumulus loyalty card status: points balance, level, cardholder, lifetime stats. Requires authentication.",
  {},
  async () => {
    try {
      const result = await getCumulusStatus();
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_in_store_receipts",
  "List the user's in-store Migros receipts (Kassenbons) over a date range. Default: last 30 days. Use get_receipt_details with an id for line items. Requires authentication.",
  GetInStoreReceiptsSchema.shape,
  async ({ startDate, endDate, limit }) => {
    try {
      const result = await getInStoreReceipts({ startDate, endDate, limit });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_receipt_details",
  "Get the URL to view a single in-store receipt's line items in the browser. Line items aren't accessible via the API — get_in_store_receipts gives store/date/amount/points which is enough for most queries. Requires authentication.",
  GetReceiptDetailsSchema.shape,
  async ({ receiptId }) => {
    try {
      const result = await getReceiptDetails({ receiptId });
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "get_cumulus_coupons",
  "List active Cumulus coupons targeted at the user (personalized offers based on shopping history). Requires authentication.",
  {},
  async () => {
    try {
      const result = await getCumulusCoupons();
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
