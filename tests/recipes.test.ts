/**
 * Unit tests for the recipe tools after Migusto's old API went away.
 * No network: the HTTP layer is replaced by a fake.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Get, HttpResponse, Post } from "../src/http.js";
import {
  checkRecipeId,
  fetchMigustoRecipe,
  fetchRecipe,
  imageUrl,
  migustoRecipeUrl,
  parseMigustoRecipePage,
  productIdsFromRecipe,
  recipeLanguage,
  recipeSearchBody,
  recipesFromSearch,
  searchRecipesRequest,
  slugFromRecipeUrl,
} from "../src/recipes.js";
import { recipeProduct } from "../src/tools.js";

function fakePost(reply: HttpResponse) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const post: Post = async (url, body, headers) => {
    calls.push({ url, body, headers });
    return reply;
  };
  return { post, calls };
}

/** Answers each GET with the next reply in the list. */
function fakeGet(...replies: HttpResponse[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const get: Get = async (url, headers) => {
    calls.push({ url, headers });
    const r = replies.shift();
    if (!r) throw new Error("unexpected request " + url);
    return r;
  };
  return { get, calls };
}

// Shaped like a migros.ch recipe search answer (keys seen in the site's code, 08.11.2026).
const searchAnswer = {
  total: 223,
  recipes: [
    {
      id: 85788,
      title: "Klassischer Risotto",
      durationTotal: "PT40M",
      canonicalUrl: "https://migusto.migros.ch/de/rezepte/klassischer-risotto/85788",
      image: "https://recipeimages.migros.ch/{stack}/abc123/klassischer-risotto-0-4-3.jpg",
      rating: { average: 4.5, count: 120 },
      teaserText: "Cremig und einfach.",
    },
    { title: "no id, skipped" },
    { id: "20683", title: "Risotto mit Stängelkohl", slug: "risotto-mit-staengelkohl" },
  ],
};

describe("recipe language", () => {
  it("keeps de, fr and it, and falls back to German otherwise", () => {
    assert.equal(recipeLanguage("de"), "de");
    assert.equal(recipeLanguage("fr"), "fr");
    assert.equal(recipeLanguage("it"), "it");
    assert.equal(recipeLanguage("en"), "de");
    assert.equal(recipeLanguage("Deutsch"), "de");
    assert.equal(recipeLanguage(undefined), "de");
  });
});

describe("recipe search request", () => {
  it("sends the search text as term, with paging, like the website", () => {
    assert.deepEqual(recipeSearchBody({ query: "risotto" }), {
      limit: 20,
      offset: 0,
      onlyContentPage: true,
      term: "risotto",
    });
  });

  it("adds ingredients to the search text", () => {
    assert.equal(recipeSearchBody({ query: " risotto ", ingredients: ["Pilze", " ", "Thymian"] }).term, "risotto Pilze Thymian");
    assert.equal(recipeSearchBody({ ingredients: ["Kürbis"] }).term, "Kürbis");
  });

  it("leaves term out when there is no text, and caps long text", () => {
    assert.equal("term" in recipeSearchBody({ limit: 5, offset: 10 }), false);
    assert.deepEqual(recipeSearchBody({ limit: 5, offset: 10 }), { limit: 5, offset: 10, onlyContentPage: true });
    assert.equal((recipeSearchBody({ query: "x".repeat(500) }).term as string).length, 200);
  });

  it("posts to the migros.ch recipe API with the guest token and language", async () => {
    const { post, calls } = fakePost({ status: 200, data: searchAnswer });
    const result = await searchRecipesRequest({ query: "risotto", limit: 3 }, "fr", "guest-token", post);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://www.migros.ch/recipe/public/v1/recipes");
    assert.deepEqual(calls[0].body, { limit: 3, offset: 0, onlyContentPage: true, term: "risotto" });
    assert.equal(calls[0].headers.leshopch, "guest-token");
    assert.equal(calls[0].headers["migros-language"], "fr");
    assert.equal(result.total, 223);
    assert.equal(result.recipes.length, 2);
  });

  it("throws on an error status", async () => {
    const { post } = fakePost({ status: 403, data: "<html>maintenance</html>" });
    await assert.rejects(searchRecipesRequest({ query: "x" }, "de", "t", post), /403/);
  });
});

describe("recipe search answer", () => {
  it("gives each recipe an id, slug, image and Migusto link", () => {
    const { recipes } = recipesFromSearch(searchAnswer, "de");
    assert.deepEqual(recipes[0], {
      id: "85788",
      slug: "klassischer-risotto",
      title: "Klassischer Risotto",
      durationTotal: "PT40M",
      rating: { average: 4.5, count: 120 },
      teaser: "Cremig und einfach.",
      image: "https://recipeimages.migros.ch/no-crop/resize-width-640/abc123/klassischer-risotto-0-4-3.jpg",
      url: "https://migusto.migros.ch/de/rezepte/klassischer-risotto/85788",
    });
    // Without canonicalUrl, the link is built from slug and id.
    assert.equal(recipes[1].url, "https://migusto.migros.ch/de/rezepte/risotto-mit-staengelkohl/20683");
  });

  it("builds French and Italian links with the right path", () => {
    const one = { recipes: [{ id: 1, slug: "risotto" }] };
    assert.equal(recipesFromSearch(one, "fr").recipes[0].url, "https://migusto.migros.ch/fr/recettes/risotto/1");
    assert.equal(recipesFromSearch(one, "it").recipes[0].url, "https://migusto.migros.ch/it/ricette/risotto/1");
  });

  it("copes with an empty or odd answer", () => {
    assert.deepEqual(recipesFromSearch(null, "de"), { total: undefined, recipes: [] });
    assert.deepEqual(recipesFromSearch({ recipes: "nope" }, "de"), { total: undefined, recipes: [] });
  });

  it("reads the slug from a recipe address and fills in image sizes", () => {
    assert.equal(slugFromRecipeUrl("https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen/39632?x=1"), "marroni-aus-dem-ofen");
    assert.equal(slugFromRecipeUrl("https://migusto.migros.ch/de/rezepte"), undefined);
    assert.equal(imageUrl({ sources: [{ url: "https://img/{stack}/a.jpg" }] }), "https://img/no-crop/resize-width-640/a.jpg");
    assert.equal(imageUrl(42), undefined);
  });
});

describe("one recipe by id", () => {
  it("accepts numeric ids only, so nothing else reaches the request path", () => {
    assert.equal(checkRecipeId(" 39632 "), "39632");
    assert.throws(() => checkRecipeId("../products"), /numeric id/);
    assert.throws(() => checkRecipeId("marroni-aus-dem-ofen"), /numeric id/);
    assert.throws(() => checkRecipeId(""), /numeric id/);
  });

  it("gets the recipe from the migros.ch recipe API", async () => {
    const { get, calls } = fakeGet({ status: 200, data: { id: 39632, title: "Marroni aus dem Ofen" } });
    const recipe = await fetchRecipe("39632", "de", "guest-token", get);
    assert.equal(calls[0].url, "https://www.migros.ch/recipe/public/v1/recipes/39632");
    assert.equal(calls[0].headers.leshopch, "guest-token");
    assert.equal(recipe.title, "Marroni aus dem Ofen");
  });

  it("throws on an error status", async () => {
    const { get } = fakeGet({ status: 404, data: {} });
    await assert.rejects(fetchRecipe("1", "de", "t", get), /404/);
  });

  it("reads the suggested products, whatever form the ids come in", () => {
    assert.deepEqual(productIdsFromRecipe({ recommendedProducts: ["266101701000", 104135500000] }), ["266101701000", "104135500000"]);
    assert.deepEqual(
      productIdsFromRecipe({ recommendedProducts: [{ migrosId: "106223300000" }, { productId: 7 }, { id: "x" }, { uid: "100006357" }] }),
      ["106223300000", "7", "100006357"]
    );
    assert.deepEqual(productIdsFromRecipe({ recommendedProducts: { productIds: ["1", "1", "2"] } }), ["1", "2"]);
    assert.deepEqual(productIdsFromRecipe({ title: "no products" }), []);
    assert.deepEqual(productIdsFromRecipe(null), []);
  });
});

describe("recipe products for the basket", () => {
  const details = [
    {
      uid: 100123456,
      migrosId: "266101701000",
      name: "Marroni",
      brand: "Migros Bio",
      offer: { price: { advertisedDisplayValue: "4.95" }, quantity: "500 g" },
    },
  ];

  it("swaps a migrosId for the product's uid, name and price", () => {
    assert.deepEqual(recipeProduct("266101701000", details), {
      uid: "100123456",
      migrosId: "266101701000",
      name: "Marroni",
      brand: "Migros Bio",
      price: "CHF 4.95",
      quantity: "500 g",
    });
  });

  it("keeps the bare id when the product details don't know it", () => {
    assert.deepEqual(recipeProduct("999999999999", details), { migrosId: "999999999999" });
    assert.deepEqual(recipeProduct("100000001", []), { uid: "100000001" });
  });
});

// A Migusto recipe page, cut down to what the parser reads. Shaped like the
// real page for "Marroni aus dem Ofen" (08.11.2026).
const recipeLd = {
  "@context": "http://schema.org",
  "@type": "Recipe",
  author: { "@type": "Person", name: "Test Author" },
  totalTime: "PT1H45M",
  datePublished: "2014-07-03T17:53:00.000Z",
  description: "Aus dem Backofen.",
  aggregateRating: { "@type": "AggregateRating", ratingValue: 4.4326, reviewCount: 141 },
  name: "Marroni aus dem Ofen",
  image: ["https://recipeimages.migros.ch/no-crop/resize-width-300/aac6/marroni-aus-dem-ofen.jpg"],
  recipeYield: "Für 8 Personen",
  recipeCategory: "Zwischenmahlzeiten",
  recipeCuisine: "Europa",
  keywords: "Glutenfrei, Laktosefrei",
  nutrition: { "@type": "NutritionInformation", calories: "250 kcal", fatContent: "2 g" },
  recipeIngredient: ["1 kg Marroni"],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Marroni ca. 1 Stunde in kaltem Wasser einlegen." },
    { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Ofen vorheizen." }] },
  ],
};

function page(opts: { canonical?: boolean; recipe?: boolean } = {}): string {
  const { canonical = true, recipe = true } = opts;
  return [
    "<!DOCTYPE html><html><head>",
    canonical ? '<link rel="canonical" href="https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen/39632"/>' : "",
    '<script type="application/ld+json">{"@context":"http://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>',
    '<script type="application/ld+json">{not json</script>',
    recipe ? `<script type="application/ld+json">${JSON.stringify(recipeLd)}</script>` : "",
    "</head><body>404</body></html>",
  ].join("");
}

describe("Migusto recipe page", () => {
  it("turns a slug into the page address, for each language", () => {
    assert.equal(migustoRecipeUrl("marroni-aus-dem-ofen", "de"), "https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen");
    assert.equal(migustoRecipeUrl("marroni-aus-dem-ofen/39632", "fr"), "https://migusto.migros.ch/fr/recettes/marroni-aus-dem-ofen/39632");
    assert.equal(
      migustoRecipeUrl("https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen/39632", "it"),
      "https://migusto.migros.ch/it/ricette/marroni-aus-dem-ofen/39632"
    );
  });

  it("refuses anything that isn't a slug", () => {
    for (const bad of ["../../api/auth/login", "a b", "", "https://example.com/x", "slug?x=1", "slug/abc"]) {
      assert.throws(() => migustoRecipeUrl(bad, "de"), /slug must be/, bad);
    }
  });

  it("reads the recipe and its id from the page", () => {
    const r = parseMigustoRecipePage(page());
    assert.ok(r);
    assert.equal(r.id, "39632");
    assert.equal(r.url, "https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen/39632");
    assert.equal(r.name, "Marroni aus dem Ofen");
    assert.deepEqual(r.recipeIngredients, ["1 kg Marroni"]);
    assert.deepEqual(r.recipeInstructions, ["Marroni ca. 1 Stunde in kaltem Wasser einlegen.", "Ofen vorheizen."]);
    assert.deepEqual(r.nutrition, { calories: "250 kcal", fatContent: "2 g" });
    assert.deepEqual(r.aggregateRating, { ratingValue: 4.4326, reviewCount: 141 });
    assert.equal(r.totalTime, "PT1H45M");
    assert.equal(r.recipeYield, "Für 8 Personen");
  });

  it("takes the id from the page address when there is no canonical link", () => {
    const r = parseMigustoRecipePage(page({ canonical: false }), "https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen/39632");
    assert.equal(r?.id, "39632");
  });

  it("returns null for a page without a recipe", () => {
    assert.equal(parseMigustoRecipePage(page({ recipe: false })), null);
  });

  it("follows Migusto's redirect from slug to slug/id", async () => {
    const { get, calls } = fakeGet(
      { status: 301, data: "", location: "/de/rezepte/marroni-aus-dem-ofen/39632" },
      { status: 200, data: page() }
    );
    const r = await fetchMigustoRecipe("marroni-aus-dem-ofen", "de", get);
    assert.equal(r.id, "39632");
    assert.deepEqual(
      calls.map((c) => c.url),
      ["https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen", "https://migusto.migros.ch/de/rezepte/marroni-aus-dem-ofen/39632"]
    );
    assert.equal(calls[0].headers.leshopch, undefined, "no token goes to Migusto");
  });

  it("doesn't follow a redirect off Migusto", async () => {
    const { get, calls } = fakeGet({ status: 302, data: "", location: "https://example.com/x" });
    await assert.rejects(fetchMigustoRecipe("marroni-aus-dem-ofen", "de", get), /outside/);
    assert.equal(calls.length, 1);
  });

  it("stops after three redirects", async () => {
    const hop = { status: 301, data: "", location: "/de/rezepte/a" };
    const { get, calls } = fakeGet(hop, hop, hop, hop);
    await assert.rejects(fetchMigustoRecipe("a", "de", get), /too often/);
    assert.equal(calls.length, 4);
  });

  it("says so when the slug is unknown (Migusto answers 200 with a 404 page)", async () => {
    const { get } = fakeGet({ status: 200, data: page({ recipe: false }) });
    await assert.rejects(fetchMigustoRecipe("does-not-exist", "de", get), /No Migusto recipe found/);
  });

  it("throws on an error status", async () => {
    const { get } = fakeGet({ status: 500, data: "" });
    await assert.rejects(fetchMigustoRecipe("a", "de", get), /500/);
  });
});
