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
} from "./tools.js";
import {
  getProfile,
  getBasket,
  addToBasket,
  updateBasketQuantity,
  removeFromBasket,
  getAddresses,
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

const server = new McpServer({
  name: "migros-mcp",
  version: "0.1.0",
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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
