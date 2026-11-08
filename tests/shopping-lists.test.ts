/**
 * Unit tests for the shopping-list overview (issue #5). No network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatShoppingLists } from "../src/auth-tools/cart.js";

describe("formatShoppingLists", () => {
  it("lists every list with its id and name", () => {
    const out = JSON.parse(
      formatShoppingLists([
        { shoppingListId: 11, shoppingListName: "Shopping list" },
        { shoppingListId: 22, shoppingListName: "Weekend" },
      ]),
    );
    assert.equal(out.count, 2);
    assert.deepEqual(out.lists, [
      { shoppingListId: 11, name: "Shopping list" },
      { shoppingListId: 22, name: "Weekend" },
    ]);
    assert.match(out.hint, /Several lists/);
  });

  it("says the default is used when there is one list", () => {
    const out = JSON.parse(formatShoppingLists([{ shoppingListId: 11, shoppingListName: "Shopping list" }]));
    assert.equal(out.count, 1);
    assert.match(out.hint, /One list/);
  });

  it("handles no lists and a missing response", () => {
    assert.equal(JSON.parse(formatShoppingLists([])).count, 0);
    assert.equal(JSON.parse(formatShoppingLists(null)).count, 0);
  });

  it("falls back to a plain name field", () => {
    const out = JSON.parse(formatShoppingLists([{ shoppingListId: 5, name: "Party" } as any]));
    assert.equal(out.lists[0].name, "Party");
  });
});
