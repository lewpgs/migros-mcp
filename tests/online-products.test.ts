/**
 * Unit tests for online-only products such as "Partner" products (issue #8).
 * No network: the HTTP layer is replaced by a fake.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getOnlineCards,
  mergeSearchResults,
  uidsNeedingOnlinePrice,
  onlineCardsBody,
  onlineSearchBody,
  onlineWarehouseId,
  productIdsFromOnlineSearch,
  searchOnline,
  type Post,
} from "../src/online.js";
import { formatOnlineCard, withOnlineOffer } from "../src/tools.js";

/** A fake transport that records each call and answers with `reply`. */
function fakePost(reply: { status: number; data: unknown }) {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const post: Post = async (url, body, headers) => {
    calls.push({ url, body, headers });
    return reply;
  };
  return { post, calls };
}

// Shaped like the website's product card for a partner product (08.11.2026).
const partnerCard = {
  brand: "Barilla",
  breadcrumb: [
    { id: "7494735", name: "Pasta, Würzmittel & Konserven" },
    { id: "7494976", name: "Teigwaren" },
  ],
  description: "Barilla · Penne Rigate · Glutenfrei",
  isConsignmentProduct: false,
  isMgbCompatible: true,
  migrosOnlineId: "222716",
  name: "Penne Rigate",
  offer: {
    badges: [{ description: "Partner", type: "PARTNER" }],
    channel: { offerType: "ONLINE", warehouseId: 2 },
    price: {
      advertisedDisplayValue: "3.50",
      advertisedValue: 3.5,
      unitPrice: { unit: "100g", value: 0.88 },
    },
    quantity: "400 g",
    quantityPrice: "0.88/100g",
    type: "STANDARD",
  },
  productAvailability: "ONLINE_ONLY",
  title: "Barilla · Penne Rigate · Glutenfrei",
  uid: 100040201,
  versioning: "Glutenfrei",
};

describe("online search request", () => {
  it("picks the website's default warehouse per language", () => {
    assert.equal(onlineWarehouseId("de"), 2);
    assert.equal(onlineWarehouseId("it"), 2);
    assert.equal(onlineWarehouseId("fr"), 1);
    assert.equal(onlineWarehouseId("en"), 1);
    assert.equal(onlineWarehouseId("xx"), 2);
    assert.equal(onlineWarehouseId(undefined), 2);
  });

  it("sends the same body as the website in order-online mode, without sponsored products", () => {
    assert.deepEqual(onlineSearchBody("barilla glutenfrei", "de"), {
      query: "barilla glutenfrei",
      language: "de",
      storeType: "ONLINE",
      warehouseId: 2,
      sortFields: [],
      sortOrder: "asc",
      from: 0,
      limit: 100,
      filters: {},
      searchAlgorithm: "DEFAULT",
      enabledSponsoredProducts: false,
    });
  });

  it("posts to the online search with the guest token and returns product ids", async () => {
    const { post, calls } = fakePost({
      status: 200,
      data: { items: [{ id: 100040201, type: "PRODUCT" }], numberOfProducts: 1 },
    });
    const ids = await searchOnline("barilla penne glutenfrei", "de", "guest-token", post);
    assert.deepEqual(ids, ["100040201"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://www.migros.ch/product-display/public/v2/products/search");
    assert.equal(calls[0].headers.leshopch, "guest-token");
    assert.equal(calls[0].headers["migros-language"], "de");
    assert.equal(calls[0].body.storeType, "ONLINE");
  });

  it("sends the language header only for a plain two-letter code", async () => {
    const { post, calls } = fakePost({ status: 200, data: { items: [] } });
    await searchOnline("x", "de\r\nX-Evil: 1", "t", post);
    assert.equal("migros-language" in calls[0].headers, false);
  });

  it("throws on an error status, so the caller can fall back", async () => {
    const { post } = fakePost({ status: 403, data: "blocked" });
    await assert.rejects(searchOnline("x", "de", "t", post), /403/);
  });
});

describe("productIdsFromOnlineSearch", () => {
  it("keeps products only, in order, as strings", () => {
    const ids = productIdsFromOnlineSearch({
      items: [
        { id: 100002154, type: "PRODUCT" },
        { id: 5, type: "GROUPED_PROMOTION" },
        { id: "100040201", type: "PRODUCT" },
        { type: "PRODUCT" },
      ],
    });
    assert.deepEqual(ids, ["100002154", "100040201"]);
  });

  it("handles empty or odd answers", () => {
    assert.deepEqual(productIdsFromOnlineSearch(null), []);
    assert.deepEqual(productIdsFromOnlineSearch({}), []);
    assert.deepEqual(productIdsFromOnlineSearch({ items: "nope" }), []);
  });
});

describe("mergeSearchResults", () => {
  const store = { productIds: ["100002154", "100007447", "100002156"], numberOfProducts: 3 };

  it("returns the in-store result unchanged when the online search adds nothing", () => {
    assert.equal(mergeSearchResults(store, []), store);
    const same = mergeSearchResults(store, ["100007447", "100002154"]);
    assert.deepEqual(same, { productIds: ["100002154", "100007447", "100002156"], numberOfProducts: 3 });
    assert.equal("onlineOnlyProductIds" in same, false);
  });

  it("appends online-only ids after the in-store ones, once each", () => {
    const merged = mergeSearchResults(store, ["100002154", "100040201", "100040190", "100040201"]);
    assert.deepEqual(merged.productIds, ["100002154", "100007447", "100002156", "100040201", "100040190"]);
    assert.deepEqual(merged.onlineOnlyProductIds, ["100040201", "100040190"]);
    assert.equal(merged.numberOfProducts, 5);
  });

  it("finds online products when the in-store search finds nothing", () => {
    const merged = mergeSearchResults({ productIds: [], numberOfProducts: 0 }, ["100040201"]);
    assert.deepEqual(merged.productIds, ["100040201"]);
    assert.equal(merged.numberOfProducts, 1);
  });
});

describe("product details fallback", () => {
  const priced = (uid: unknown) => ({ uid, offer: { price: { advertisedDisplayValue: "3.90" } } });

  it("asks the online shop only for uids without an in-store price", () => {
    // Live 08.11.2026: the partner penne comes back from the in-store details, but with no offer.
    const details = [priced(100002154), priced("100007447"), { uid: 100040201, name: "Penne Rigate" }];
    assert.deepEqual(
      uidsNeedingOnlinePrice(["100002154", "100040201", "100007447", "100040190"], details),
      ["100040201", "100040190"],
    );
  });

  it("makes no online call when every product has an in-store price", () => {
    assert.deepEqual(uidsNeedingOnlinePrice(["100002154"], [priced(100002154)]), []);
  });

  it("ignores duplicates and ids that aren't numbers", () => {
    assert.deepEqual(uidsNeedingOnlinePrice(["100040201", "100040201", "abc", ""], []), ["100040201"]);
  });

  it("asks for product cards the way the website does", () => {
    const body = onlineCardsBody(["100040201", "100040190"], new Date("2026-11-08T10:00:00Z")) as any;
    assert.deepEqual(body, {
      offerFilter: { storeType: "ONLINE", warehouseId: 2, ongoingOfferDate: "2026-11-08T00:00:00" },
      productFilter: { uids: [100040201, 100040190] },
    });
  });

  it("posts the card request with the guest token", async () => {
    const { post, calls } = fakePost({ status: 200, data: [partnerCard] });
    const cards = await getOnlineCards(["100040201"], "guest-token", post);
    assert.equal(cards.length, 1);
    assert.equal(calls[0].url, "https://www.migros.ch/product-display/public/v4/product-cards");
    assert.equal(calls[0].headers.leshopch, "guest-token");
    assert.deepEqual(calls[0].body.productFilter, { uids: [100040201] });
  });

  it("makes no call without numeric uids, and copes with odd answers", async () => {
    const none = fakePost({ status: 200, data: [] });
    assert.deepEqual(await getOnlineCards(["abc"], "t", none.post), []);
    assert.equal(none.calls.length, 0);
    const odd = fakePost({ status: 200, data: { error: "x" } });
    assert.deepEqual(await getOnlineCards(["1"], "t", odd.post), []);
    const failed = fakePost({ status: 500, data: "" });
    await assert.rejects(getOnlineCards(["1"], "t", failed.post), /500/);
  });
});

describe("formatOnlineCard", () => {
  it("shows a partner product with price, availability and its website link", () => {
    const out = formatOnlineCard(partnerCard);
    assert.equal(out.uid, 100040201);
    assert.equal(out.name, "Penne Rigate");
    assert.equal(out.brand, "Barilla");
    assert.equal(out.price, "CHF 3.50");
    assert.equal(out.unitPrice, "CHF 0.88/100g");
    assert.equal(out.quantity, "400 g");
    assert.equal(out.partner, true);
    assert.equal(out.availability, "ONLINE_ONLY");
    assert.equal("isAvailable" in out, false);
    assert.deepEqual(out.categories, ["Pasta, Würzmittel & Konserven", "Teigwaren"]);
    assert.equal(out.migrosOnlineId, "222716");
    assert.equal(out.url, "https://www.migros.ch/de/product/mo/222716");
    assert.match(String(out.source), /Migros Online/);
  });

  it("doesn't mark products without a Partner badge as partner", () => {
    const card = { ...partnerCard, offer: { ...partnerCard.offer, badges: [{ type: "PROMOTION" }] } };
    assert.equal("partner" in formatOnlineCard(card), false);
  });
});

describe("withOnlineOffer", () => {
  it("adds the online price and Partner flag to in-store details that had none", () => {
    const inStore = {
      uid: 100040201,
      name: "Penne Rigate",
      brand: "Barilla",
      versioning: "glutenfrei",
      nutrition: "| Nutrient | per 100g |",
      isAvailable: false,
    };
    const out = withOnlineOffer(inStore, partnerCard);
    assert.equal(out.name, "Penne Rigate");
    assert.equal(out.nutrition, "| Nutrient | per 100g |");
    assert.equal(out.price, "CHF 3.50");
    assert.equal(out.unitPrice, "CHF 0.88/100g");
    assert.equal(out.quantity, "400 g");
    assert.equal(out.partner, true);
    assert.equal(out.availability, "ONLINE_ONLY");
    assert.equal("isAvailable" in out, false);
    assert.equal(out.url, "https://www.migros.ch/de/product/mo/222716");
    assert.equal("source" in out, false);
  });
});
