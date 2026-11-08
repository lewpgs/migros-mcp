import { defaultGet, getMigros, migrosHeaders, type Get } from "./http.js";

/**
 * Recipes (Migusto, Migros' recipe site).
 *
 * Migusto moved to a new website in 2026. Its old JSON API (`.rest/recipes/v1`
 * and `.rest/recipeProducts/v1`, which migros-api-wrapper calls) now answers
 * with a 404 web page (checked 08.11.2026). What replaces it:
 *
 * - search: Migusto's recipe list page, `/de/rezept-uebersicht?q=<text>`.
 *   migros.ch also has a recipe search API, but it ignores search text
 *   (checked live 08.11.2026: "risotto" gave the season's marroni recipes).
 * - one recipe by id, with its suggested products: migros.ch's recipe API,
 *   anonymous with the guest token. Same recipes and ids as Migusto.
 * - details by slug: the Migusto recipe page, which carries the recipe as
 *   schema.org data.
 */

export const RECIPE_LANGUAGES = ["de", "fr", "it"] as const;
export type RecipeLanguage = (typeof RECIPE_LANGUAGES)[number];

/** Migusto has no English recipes. Anything else falls back to German. */
export function recipeLanguage(language?: string): RecipeLanguage {
  return (RECIPE_LANGUAGES as readonly string[]).includes(language ?? "") ? (language as RecipeLanguage) : "de";
}

const MIGUSTO_ORIGIN = "https://migusto.migros.ch";
const RECIPE_SEGMENT: Record<RecipeLanguage, string> = { de: "rezepte", fr: "recettes", it: "ricette" };
const OVERVIEW_SEGMENT: Record<RecipeLanguage, string> = {
  de: "rezept-uebersicht",
  fr: "apercu-des-recettes",
  it: "panoramica-delle-ricette",
};
const HTML_HEADERS = { accept: "text/html,application/xhtml+xml,*/*" };

/** Image addresses come with a `{stack}` placeholder for the size; Migusto fills in a width. */
const IMAGE_STACK = "no-crop/resize-width-640";

// ---------------------------------------------------------------------------
// Search (Migusto recipe list page)
// ---------------------------------------------------------------------------

export interface RecipeSearchArgs {
  query?: string;
  ingredients?: string[];
  limit?: number;
  offset?: number;
}

/**
 * The search text. Ingredients are added to it, as Migusto's search box
 * takes "Rezept, Zutaten oder Kategorie" (recipe, ingredients or category)
 * in one field.
 */
export function recipeSearchTerm(args: RecipeSearchArgs): string {
  return [args.query, ...(args.ingredients ?? [])]
    .map((w) => (typeof w === "string" ? w.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
}

/** Recipes per page on Migusto's list. */
export const PAGE_SIZE = 24;

/**
 * Which list page holds recipes offset..offset+limit, and the position of
 * its first recipe. Like the website: pages 1 to 3 hold everything up to
 * that page, later pages only their own 24. One page per call; if the range
 * runs past it, fewer recipes come back and the AI can ask again from there.
 */
export function overviewPageFor(offset: number, limit: number): { page: number; startsAt: number } {
  const end = offset + limit;
  if (end <= 3 * PAGE_SIZE) return { page: Math.max(1, Math.ceil(end / PAGE_SIZE)), startsAt: 0 };
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  if (page <= 3) return { page: 3, startsAt: 0 };
  return { page, startsAt: (page - 1) * PAGE_SIZE };
}

export function recipeOverviewUrl(term: string, language: RecipeLanguage, page = 1): string {
  const params = new URLSearchParams();
  if (term) params.set("q", term);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return `${MIGUSTO_ORIGIN}/${language}/${OVERVIEW_SEGMENT[language]}${qs ? `?${qs}` : ""}`;
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
    const img = image as { url?: unknown; src?: unknown; sources?: Array<{ url?: unknown; ratio?: unknown }> };
    const sources = Array.isArray(img.sources) ? img.sources : [];
    const pick = sources.find((x) => x?.ratio === "4-3") ?? sources[0];
    url = str(img.url) ?? str(img.src) ?? str(pick?.url);
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
  // Migusto's list cards say what they link to; skip anything that isn't a recipe.
  const target = r.target as { type?: unknown; recipe?: { id?: unknown; slug?: unknown } } | undefined;
  if (target?.type !== undefined && target.type !== "RECIPE") return null;
  const id = idOf(target?.recipe?.id) ?? idOf(r.id);
  if (!id) return null;
  const canonical = absoluteUrl(str(r.canonicalUrl) ?? str(r.url));
  const slug = str(target?.recipe?.slug) ?? str(r.slug) ?? slugFromRecipeUrl(canonical);
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

/** The text Next.js streams into the page (`self.__next_f.push([1, "..."])`), joined. */
function nextFlightData(html: string): string {
  const chunks: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      chunks.push(JSON.parse(m[1]) as string);
    } catch {
      // a chunk we can't read; the recipe list is usually in another one
    }
  }
  return chunks.join("");
}

/** The JSON object or array that starts at `start`, or undefined. */
function jsonValueAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
    if (depth === 0 && i === start) return undefined; // not an object or array
  }
  return undefined;
}

/**
 * The recipes on a Migusto recipe list page, or null if the page has no
 * recipe list (then Migusto changed its page and this needs a look).
 */
export function recipesFromOverviewPage(
  html: string,
  language: RecipeLanguage
): { total?: number; recipes: RecipeSummary[] } | null {
  const key = '"initialRecipeData":';
  for (const text of [nextFlightData(html), html]) {
    const at = text.indexOf(key);
    if (at === -1) continue;
    const data = jsonValueAt(text, at + key.length);
    if (data && typeof data === "object") return recipesFromSearch(data, language);
  }
  return null;
}

export async function searchRecipesRequest(
  args: RecipeSearchArgs,
  language: RecipeLanguage,
  get: Get = defaultGet
): Promise<{ total?: number; recipes: RecipeSummary[] }> {
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 20;
  const { page, startsAt } = overviewPageFor(offset, limit);
  const r = await get(recipeOverviewUrl(recipeSearchTerm(args), language, page), HTML_HEADERS);
  if (r.status < 200 || r.status >= 300) throw new Error(`GET Migusto recipe list -> ${r.status}`);
  const found = typeof r.data === "string" ? recipesFromOverviewPage(r.data, language) : null;
  if (!found) throw new Error("Migusto's recipe list page has changed: no recipe list found on it");
  return { total: found.total, recipes: found.recipes.slice(offset - startsAt, offset - startsAt + limit) };
}

// ---------------------------------------------------------------------------
// One recipe by id (migros.ch recipe API)
// ---------------------------------------------------------------------------

const RECIPES_PATH = "/recipe/public/v1/recipes";

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
