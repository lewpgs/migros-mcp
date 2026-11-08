import { defaultGet, defaultPost, getMigros, migrosHeaders, postMigros, type Get, type Post } from "./http.js";

/**
 * Recipes (Migusto, Migros' recipe site).
 *
 * Migusto moved to a new website in 2026. Its old JSON API (`.rest/recipes/v1`
 * and `.rest/recipeProducts/v1`, which migros-api-wrapper calls) now answers
 * with a 404 web page (checked 08.11.2026). migros.ch has its own recipe API
 * with the same recipes and ids, anonymous with the guest token: search and
 * full recipes come from there. Recipe details by slug come from the Migusto
 * recipe page, which still carries the recipe as schema.org data.
 */

export const RECIPE_LANGUAGES = ["de", "fr", "it"] as const;
export type RecipeLanguage = (typeof RECIPE_LANGUAGES)[number];

/** Migusto has no English recipes. Anything else falls back to German. */
export function recipeLanguage(language?: string): RecipeLanguage {
  return (RECIPE_LANGUAGES as readonly string[]).includes(language ?? "") ? (language as RecipeLanguage) : "de";
}

const MIGUSTO_ORIGIN = "https://migusto.migros.ch";
const RECIPE_SEGMENT: Record<RecipeLanguage, string> = { de: "rezepte", fr: "recettes", it: "ricette" };

/** Image addresses come with a `{stack}` placeholder for the size; Migusto fills in a width. */
const IMAGE_STACK = "no-crop/resize-width-640";

// ---------------------------------------------------------------------------
// Search (migros.ch recipe API)
// ---------------------------------------------------------------------------

const RECIPES_PATH = "/recipe/public/v1/recipes";

export interface RecipeSearchArgs {
  query?: string;
  ingredients?: string[];
  limit?: number;
  offset?: number;
}

/**
 * The search body. migros.ch sends `{...filters, onlyContentPage: true}`;
 * the search text goes in `term`, the name Migusto's own search uses for it.
 * Ingredients are added to the search text, as Migusto's search box takes
 * "recipe, ingredients or category" in one field.
 */
export function recipeSearchBody(args: RecipeSearchArgs): Record<string, unknown> {
  const words = [args.query, ...(args.ingredients ?? [])]
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter(Boolean);
  const body: Record<string, unknown> = {
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
    onlyContentPage: true,
  };
  if (words.length > 0) body.term = words.join(" ").slice(0, 200);
  return body;
}

export interface RecipeSummary {
  id: string;
  slug?: string;
  title?: string;
  durationTotal?: string;
  rating?: unknown;
  teaser?: string;
  image?: string;
  url?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function idOf(v: unknown): string | undefined {
  return typeof v === "number" || (typeof v === "string" && v.length > 0) ? String(v) : undefined;
}

/** An image address with the size filled in, from a plain address or an image object. */
export function imageUrl(image: unknown): string | undefined {
  let url: string | undefined;
  if (typeof image === "string") url = image;
  else if (image && typeof image === "object") {
    const img = image as { url?: unknown; src?: unknown; sources?: Array<{ url?: unknown }> };
    url = str(img.url) ?? str(img.src) ?? (Array.isArray(img.sources) ? str(img.sources[0]?.url) : undefined);
  }
  return url?.replace("{stack}", IMAGE_STACK);
}

/** The slug of a Migusto recipe address, `/de/rezepte/<slug>/<id>`. */
export function slugFromRecipeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const parts = url.split(/[?#]/)[0].split("/").filter(Boolean);
  const last = parts.length - 1;
  if (last >= 1 && /^\d+$/.test(parts[last])) return parts[last - 1];
  return undefined;
}

export function migustoRecipeLink(id: string, slug: string, language: RecipeLanguage): string {
  return `${MIGUSTO_ORIGIN}/${language}/${RECIPE_SEGMENT[language]}/${slug}/${id}`;
}

function absoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https:\/\//.test(url)) return url;
  if (url.startsWith("/")) return `${MIGUSTO_ORIGIN}${url}`;
  return undefined;
}

/** One recipe of a search answer, trimmed to what helps pick a recipe. */
export function recipeSummary(r: Record<string, unknown>, language: RecipeLanguage): RecipeSummary | null {
  const id = idOf(r.id);
  if (!id) return null;
  const canonical = absoluteUrl(str(r.canonicalUrl) ?? str(r.url));
  const slug = str(r.slug) ?? slugFromRecipeUrl(canonical);
  return {
    id,
    slug,
    title: str(r.title),
    durationTotal: str(r.durationTotal) ?? str(r.duration),
    rating: r.rating,
    teaser: str(r.teaserText) ?? str(r.description),
    image: imageUrl(r.image),
    url: canonical ?? (slug ? migustoRecipeLink(id, slug, language) : undefined),
  };
}

export function recipesFromSearch(
  data: unknown,
  language: RecipeLanguage
): { total?: number; recipes: RecipeSummary[] } {
  const d = (data ?? {}) as { recipes?: unknown; total?: unknown; totalCount?: unknown };
  const list = Array.isArray(d.recipes) ? d.recipes : Array.isArray(data) ? data : [];
  const recipes = list
    .map((r) => (r && typeof r === "object" ? recipeSummary(r as Record<string, unknown>, language) : null))
    .filter((r): r is RecipeSummary => r !== null);
  const total = typeof d.total === "number" ? d.total : typeof d.totalCount === "number" ? d.totalCount : undefined;
  return { total, recipes };
}

export async function searchRecipesRequest(
  args: RecipeSearchArgs,
  language: RecipeLanguage,
  token: string,
  post: Post = defaultPost
): Promise<{ total?: number; recipes: RecipeSummary[] }> {
  const data = await postMigros(post, RECIPES_PATH, recipeSearchBody(args), migrosHeaders(token, language));
  return recipesFromSearch(data, language);
}

// ---------------------------------------------------------------------------
// One recipe by id (migros.ch recipe API)
// ---------------------------------------------------------------------------

/** Recipe ids are numbers (e.g. 39632). Anything else never reaches the request path. */
export function checkRecipeId(id: string): string {
  const trimmed = String(id ?? "").trim();
  if (!/^\d{1,12}$/.test(trimmed)) {
    throw new Error(`recipeId must be the numeric id from search_recipes (got "${id}")`);
  }
  return trimmed;
}

export async function fetchRecipe(
  id: string,
  language: RecipeLanguage,
  token: string,
  get: Get = defaultGet
): Promise<Record<string, unknown>> {
  const data = await getMigros(get, `${RECIPES_PATH}/${checkRecipeId(id)}`, migrosHeaders(token, language));
  if (!data || typeof data !== "object") throw new Error(`Recipe ${id}: unexpected answer`);
  return data as Record<string, unknown>;
}

/**
 * The Migros products a recipe suggests (`recommendedProducts`), as product
 * ids in the order given. These are the products Migusto shows under
 * "Zutaten in deiner Migros" (ingredients in your Migros). Accepts plain ids
 * or product objects, as the field's exact shape isn't documented.
 */
export function productIdsFromRecipe(recipe: unknown): string[] {
  const rec = (recipe ?? {}) as { recommendedProducts?: unknown };
  let list = rec.recommendedProducts;
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const inner = list as { productIds?: unknown; products?: unknown; items?: unknown };
    list = inner.productIds ?? inner.products ?? inner.items;
  }
  if (!Array.isArray(list)) return [];
  const ids: string[] = [];
  for (const item of list) {
    let id: string | undefined;
    if (typeof item === "string" || typeof item === "number") id = String(item);
    else if (item && typeof item === "object") {
      const p = item as Record<string, unknown>;
      id = idOf(p.migrosId) ?? idOf(p.productId) ?? idOf(p.uid) ?? idOf(p.id);
    }
    if (id && /^\d+$/.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Recipe details by slug (Migusto recipe page)
// ---------------------------------------------------------------------------

export interface MigustoRecipe {
  id: string;
  name?: string;
  description?: string;
  keywords?: string;
  author?: unknown;
  aggregateRating?: { ratingValue?: unknown; reviewCount?: unknown };
  images?: unknown;
  totalTime?: string;
  recipeCategory?: unknown;
  recipeCuisine?: unknown;
  recipeYield?: unknown;
  recipeIngredients?: string[];
  recipeInstructions?: string[];
  nutrition?: Record<string, string>;
  datePublished?: string;
  url?: string;
}

/**
 * The page address for a slug. Also takes `slug/id` or a full Migusto recipe
 * address, as search results give both. Anything that isn't a plain slug is
 * refused, so the AI can't point the request at another page.
 */
export function migustoRecipeUrl(slug: string, language: RecipeLanguage): string {
  let s = String(slug ?? "").trim();
  const fromUrl = /\/(?:rezepte|recettes|ricette)\/([^?#]+)/.exec(s);
  if (/^https?:\/\//.test(s) && fromUrl) s = fromUrl[1];
  s = s.replace(/^\/+|\/+$/g, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/\d+)?$/i.test(s)) {
    throw new Error(`slug must be a recipe slug from search_recipes, like "marroni-aus-dem-ofen" (got "${slug}")`);
  }
  return `${MIGUSTO_ORIGIN}/${language}/${RECIPE_SEGMENT[language]}/${s}`;
}

function findRecipeNode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findRecipeNode(n);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return obj;
  return obj["@graph"] ? findRecipeNode(obj["@graph"]) : null;
}

function stepTexts(instructions: unknown): string[] {
  if (typeof instructions === "string") return [instructions];
  if (Array.isArray(instructions)) return instructions.flatMap(stepTexts);
  if (instructions && typeof instructions === "object") {
    const step = instructions as { text?: unknown; itemListElement?: unknown };
    if (typeof step.text === "string") return [step.text];
    if (step.itemListElement) return stepTexts(step.itemListElement);
  }
  return [];
}

function nutritionOf(n: unknown): Record<string, string> | undefined {
  if (!n || typeof n !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
    if (!k.startsWith("@") && (typeof v === "string" || typeof v === "number")) out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function canonicalUrl(html: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel="canonical"/i.test(tag)) {
      const href = /\bhref="([^"]+)"/i.exec(tag);
      if (href) return href[1];
    }
  }
  return undefined;
}

/** The recipe on a Migusto recipe page, or null if the page has none (an unknown slug). */
export function parseMigustoRecipePage(html: string, pageUrl?: string): MigustoRecipe | null {
  let recipe: Record<string, unknown> | null = null;
  const scripts = html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scripts) {
    try {
      recipe = findRecipeNode(JSON.parse(m[1]));
    } catch {
      continue;
    }
    if (recipe) break;
  }
  if (!recipe) return null;

  const url = canonicalUrl(html) ?? pageUrl;
  const idMatch = url ? /\/(\d+)\/?(?:[?#].*)?$/.exec(url) : null;
  const rating = recipe.aggregateRating as { ratingValue?: unknown; reviewCount?: unknown } | undefined;
  const ingredients = recipe.recipeIngredient;
  const published = str(recipe.datePublished);

  return {
    id: idMatch ? idMatch[1] : "",
    name: str(recipe.name),
    description: str(recipe.description),
    keywords: str(recipe.keywords),
    author: recipe.author,
    aggregateRating: rating ? { ratingValue: rating.ratingValue, reviewCount: rating.reviewCount } : undefined,
    images: recipe.image,
    totalTime: str(recipe.totalTime),
    recipeCategory: recipe.recipeCategory,
    recipeCuisine: recipe.recipeCuisine,
    recipeYield: recipe.recipeYield,
    recipeIngredients: Array.isArray(ingredients) ? ingredients.filter((i): i is string => typeof i === "string") : undefined,
    recipeInstructions: stepTexts(recipe.recipeInstructions),
    nutrition: nutritionOf(recipe.nutrition),
    datePublished: published,
    url,
  };
}

/**
 * Fetch and read a Migusto recipe page. A slug without an id redirects to
 * `<slug>/<id>`; up to three redirects are followed, all within Migusto.
 */
export async function fetchMigustoRecipe(
  slug: string,
  language: RecipeLanguage,
  get: Get = defaultGet
): Promise<MigustoRecipe> {
  let url = migustoRecipeUrl(slug, language);
  const headers = { accept: "text/html,application/xhtml+xml,*/*" };
  for (let hop = 0; hop <= 3; hop++) {
    const r = await get(url, headers);
    if (r.status >= 300 && r.status < 400 && r.location) {
      const next = new URL(r.location, url);
      if (next.origin !== MIGUSTO_ORIGIN) throw new Error(`Migusto redirected outside its site (${next.origin})`);
      url = next.href;
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`GET Migusto recipe page -> ${r.status}`);
    const recipe = typeof r.data === "string" ? parseMigustoRecipePage(r.data, url) : null;
    if (!recipe) throw new Error(`No Migusto recipe found for "${slug}". Use a slug from search_recipes.`);
    return recipe;
  }
  throw new Error("Migusto redirected too often");
}
