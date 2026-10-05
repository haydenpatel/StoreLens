import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shopifyAdapter } from "./shopify";
import { expectAdapterShape, expectNeutralProduct } from "../__fixtures__/adapter-contract";
import { catalog, product, scatteredOptionsCatalog, variant } from "../__fixtures__/shopify";
import { jsonResponse, memoryStorage } from "../__fixtures__/test-helpers";

const COLLECTION = "https://shop.example.com/collections/all";

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

// Runs raw products through the adapter's public API, as the app does.
async function load(raw) {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ products: raw })));
  const { products, pageError } = await shopifyAdapter.fetchCollection(COLLECTION);
  expect(pageError).toBeNull();
  return products;
}

describe("the Shopify adapter follows the adapter contract", () => {
  it("has the adapter shape", () => {
    expectAdapterShape(shopifyAdapter);
  });

  it.each([
    ["the filter catalog", catalog],
    ["products with options scattered across positions", scatteredOptionsCatalog],
  ])("returns neutral products for %s", async (_, makeCatalog) => {
    const products = await load(makeCatalog());
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) expectNeutralProduct(p, shopifyAdapter.capabilities);
  });

  it("returns neutral products for the edge cases Shopify sends", async () => {
    const products = await load([
      // The Title / Default Title placeholder, which has no real options.
      product({ handle: "placeholder", options: [{ name: "Title", values: ["Default Title"] }], variants: [variant({ title: "Default Title", option1: "Default Title" })] }),
      // Tags as a comma-separated string, a "0.00" compare-at price, and no images.
      product({ handle: "odd", tags: "a, b", images: [], variants: [variant({ compare_at_price: "0.00" })] }),
      // Everything sold out.
      product({ handle: "sold-out", variants: [variant({ available: false })] }),
    ]);
    expect(products).toHaveLength(3);
    for (const p of products) expectNeutralProduct(p, shopifyAdapter.capabilities);
  });
});
