/**
 * Unit tests for get_categories on the new storemap address.
 * No network: the HTTP layer is replaced by a fake.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Get, HttpResponse } from "../src/http.js";
import { categoriesFromStoremap, fetchCategories, storemapPath } from "../src/categories.js";

function fakeGet(reply: HttpResponse) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const get: Get = async (url, headers) => {
    calls.push({ url, headers });
    return reply;
  };
  return { get, calls };
}

const storemap = {
  categories: [
    { id: "7494731", name: "Früchte & Gemüse", slug: "fruechte-gemuese", children: [{ id: "7494732", name: "Früchte" }] },
    { id: "7494735", name: "Pasta, Würzmittel & Konserven", slug: "pasta-wuerzmittel-konserven" },
  ],
};

describe("storemap address", () => {
  it("asks for the national store map in the given language", () => {
    assert.equal(
      storemapPath(),
      "/product-display/public/v1/storemap?language=de&regionId=national&storeMapScope=DEFAULT"
    );
    assert.equal(
      storemapPath("fr"),
      "/product-display/public/v1/storemap?language=fr&regionId=national&storeMapScope=DEFAULT"
    );
    assert.match(storemapPath("de&x=1"), /language=de&regionId/);
  });
});

describe("get_categories request", () => {
  it("gets the store map from www.migros.ch with the guest token", async () => {
    const { get, calls } = fakeGet({ status: 200, data: storemap });
    const categories = await fetchCategories("guest-token", "de", get);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://www.migros.ch/product-display/public/v1/storemap?language=de&regionId=national&storeMapScope=DEFAULT"
    );
    assert.equal(calls[0].headers.leshopch, "guest-token");
    assert.equal(calls[0].headers["migros-language"], "de");
    assert.deepEqual(categories, storemap.categories);
  });

  it("throws on an error status, without the query string in the message", async () => {
    const { get } = fakeGet({ status: 404, data: "" });
    await assert.rejects(fetchCategories("t", "de", get), (e: Error) => {
      assert.match(e.message, /404/);
      assert.doesNotMatch(e.message, /\?/);
      return true;
    });
  });

  it("copes with an answer in another shape", () => {
    assert.deepEqual(categoriesFromStoremap([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(categoriesFromStoremap({}), []);
    assert.deepEqual(categoriesFromStoremap(null), []);
  });
});
