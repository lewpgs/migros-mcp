import { z } from "zod";

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
    .describe(
      "Array of product IDs (UIDs) to get details for. Get these from search_products first."
    ),
});

export const SearchStoresSchema = z.object({
  query: z
    .string()
    .describe("Search query for Migros stores (city name, zip code, etc.)"),
});

export const GetPromotionsSchema = z.object({
  query: z
    .string()
    .optional()
    .default("")
    .describe("Optional search query to filter promotions"),
});
