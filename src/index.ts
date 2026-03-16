#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SearchProductsSchema,
  GetProductDetailsSchema,
  SearchStoresSchema,
  GetPromotionsSchema,
} from "./schemas.js";
import {
  searchProducts,
  getProductDetails,
  getCategories,
  searchStores,
  getPromotions,
} from "./tools.js";

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

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
