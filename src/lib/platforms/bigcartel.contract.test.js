import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bigcartelAdapter, clearFeedCache } from "./bigcartel";
import { expectAdapterShape, expectNeutralProduct } from "../__fixtures__/adapter-contract";
import { catalog, option, product, sized } from "../__fixtures__/bigcartel";
import { fakeBigCartelFetch } from "../__fixtures__/fake-bigcartel-fetch";

const SHOP_URL = "https://example-shop.bigcartel.com/products";

beforeEach(clearFeedCache);
afterEach(() => vi.unstubAllGlobals());

// Runs raw products through the adapter's public API, as the app does.
async function load(raw, url = SHOP_URL, stores) {
  vi.stubGlobal("fetch", fakeBigCartelFetch({ "example-shop": raw }, undefined, { stores: { "example-shop": stores } }));
  const { products, pageError } = await bigcartelAdapter.fetchCollection(url);
  expect(pageError).toBeNull();
  return products;
}

describe("the Big Cartel adapter follows the adapter contract", () => {
  it("has the adapter shape", () => {
    expectAdapterShape(bigcartelAdapter);
  });

  it("returns neutral products for the catalog", async () => {
    const products = await load(catalog());
    expect(products).toHaveLength(catalog().length);
    for (const p of products) expectNeutralProduct(p, bigcartelAdapter.capabilities);
  });

  it("returns neutral products for the edge cases the feed can send", async () => {
    const products = await load([
      // No options at all.
      product({ permalink: "no-options", options: [] }),
      // No images, no created_at.
      product({ permalink: "bare", images: [], created_at: undefined }),
      // A date format we can't read.
      product({ permalink: "odd", created_at: "sometime" }),
      // Every size sold out.
      sized({ permalink: "sold-out" }, ["S", "M"], { soldOut: ["S", "M"] }),
      // On sale flag with no discount.
      product({ permalink: "flagged", on_sale: true }),
      // A price that isn't a number.
      product({ permalink: "bad-price", options: [option("Default", { price: "free" })] }),
    ]);
    expect(products).toHaveLength(6);
    for (const p of products) expectNeutralProduct(p, bigcartelAdapter.capabilities);
  });

  it("returns neutral products with the shop's currency set, or without it when store.json is unavailable", async () => {
    for (const p of await load(catalog(), SHOP_URL, { currency: "EUR" })) {
      expectNeutralProduct(p, bigcartelAdapter.capabilities);
      expect(p.currency).toBe("EUR");
    }
    clearFeedCache();
    for (const p of await load(catalog(), SHOP_URL, null)) expectNeutralProduct(p, bigcartelAdapter.capabilities);
  });

  it("returns neutral products for a category", async () => {
    const products = await load(catalog(), "https://example-shop.bigcartel.com/category/tees");
    expect(products.map((p) => p.handle)).toEqual(["example-tee", "example-hoodie", "example-print"]);
    for (const p of products) expectNeutralProduct(p, bigcartelAdapter.capabilities);
  });
});
