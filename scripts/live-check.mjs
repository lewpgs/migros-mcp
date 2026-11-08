#!/usr/bin/env node
// Live check: starts the built server (dist/index.js) without any Migros
// account and calls every tool that needs no account against the real Migros
// website. Migros moves its addresses without notice, so this is the early
// warning. Exits 1 if any tool fails or answers with nothing useful.
//
// Usage: npm run build && npm run live-check

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const CALL_TIMEOUT_MS = 60_000;

// No account, no update notice: only the anonymous tools, nothing else.
const env = { ...process.env, MIGROS_MCP_UPDATE_CHECK: "false" };
for (const key of ["MIGROS_EMAIL", "MIGROS_PASSWORD", "MIGROS_TOTP_SECRET"]) delete env[key];

const server = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let nextId = 1;

createInterface({ input: server.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const waiter = pending.get(msg.id);
  if (waiter) {
    pending.delete(msg.id);
    waiter(msg);
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`no answer within ${CALL_TIMEOUT_MS / 1000} s`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

/** Call a tool and return its text answer. Throws on a tool error. */
async function callTool(name, args = {}) {
  const result = await request("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";
  if (result?.isError) throw new Error(text.slice(0, 300) || "tool returned an error");
  return text;
}

function json(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what}: answer is not JSON: ${text.slice(0, 200)}`);
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];
async function step(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`ok    ${name}${note ? `  (${note})` : ""}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}  ${String(err.message ?? err).replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

const NO_ACCOUNT_TOOLS = [
  "search_products",
  "get_product_details",
  "get_stock",
  "get_categories",
  "search_stores",
  "get_promotions",
  "search_recipes",
  "get_recipe_details",
  "get_recipe_products",
];

let productId;
let storeId;
let recipe;

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "live-check", version: "1" },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  console.log(`server ${init.serverInfo?.name} ${init.serverInfo?.version}`);

  await step("tools/list", async () => {
    const { tools } = await request("tools/list", {});
    const names = new Set(tools.map((t) => t.name));
    const missing = NO_ACCOUNT_TOOLS.filter((n) => !names.has(n));
    check(missing.length === 0, `missing: ${missing.join(", ")}`);
    return `${tools.length} tools`;
  });

  await step("search_products", async () => {
    const out = json(await callTool("search_products", { query: "Milch" }), "search_products");
    check(Array.isArray(out.productIds) && out.productIds.length > 0, "no products found for 'Milch'");
    productId = String(out.productIds[0]);
    return `${out.productIds.length} products`;
  });

  await step("get_product_details", async () => {
    check(productId, "skipped: no product from search_products");
    const out = json(await callTool("get_product_details", { productIds: [productId] }), "get_product_details");
    check(Array.isArray(out) && out.length > 0 && out[0].name, "no details returned");
    return "name and details present";
  });

  await step("search_stores", async () => {
    const out = json(await callTool("search_stores", { query: "Zürich" }), "search_stores");
    check(Array.isArray(out) && out.length > 0 && out[0].costCenterId, "no stores found for 'Zürich'");
    storeId = String(out[0].costCenterId);
    return `${out.length} stores`;
  });

  await step("get_stock", async () => {
    check(productId && storeId, "skipped: needs a product and a store");
    const out = json(await callTool("get_stock", { productId, storeId }), "get_stock");
    check(typeof out.inStock === "boolean", "no inStock answer");
    return "stock answer present";
  });

  await step("get_categories", async () => {
    const text = await callTool("get_categories");
    check(text.length > 200, "answer is (nearly) empty");
    return `${text.length} characters`;
  });

  await step("get_promotions", async () => {
    const text = await callTool("get_promotions", { query: "" });
    check(text.length > 200, "answer is (nearly) empty");
    return `${text.length} characters`;
  });

  await step("search_recipes", async () => {
    const out = json(await callTool("search_recipes", { query: "Risotto", limit: 3 }), "search_recipes");
    check(Array.isArray(out.recipes) && out.recipes.length > 0, "no recipes found for 'Risotto'");
    recipe = out.recipes[0];
    check(recipe.slug && recipe.id, "recipe has no slug or id");
    return `${out.total ?? out.recipes.length} recipes`;
  });

  await step("get_recipe_details", async () => {
    check(recipe, "skipped: no recipe from search_recipes");
    const out = json(await callTool("get_recipe_details", { slug: recipe.slug }), "get_recipe_details");
    check(out.id && out.name, "recipe has no id or name");
    return "id and name present";
  });

  await step("get_recipe_products", async () => {
    check(recipe, "skipped: no recipe from search_recipes");
    const out = json(await callTool("get_recipe_products", { recipeId: String(recipe.id) }), "get_recipe_products");
    check(Array.isArray(out.products), "no products list");
    return `${out.products.length} products`;
  });
} catch (err) {
  console.log(`FAIL  server  ${err.message ?? err}`);
  results.push({ name: "server", ok: false });
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
