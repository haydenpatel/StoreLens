import { afterEach, describe, expect, it, vi } from "vitest";
import { fourthwallAdapter } from "./fourthwall";
import { expectAdapterShape, expectNeutralProduct } from "../__fixtures__/adapter-contract";
import { catalog, product, variant } from "../__fixtures__/fourthwall";
import { fakeFourthwallFetch } from "../__fixtures__/fake-fourthwall-fetch";

const COLLECTION = "https://shop.example.com/collections/all";

afterEach(() => vi.unstubAllGlobals());

// Runs raw products through the adapter's public API, as the app does.
async function load(raw, url = COLLECTION) {
  vi.stubGlobal("fetch", fakeFourthwallFetch({ "shop.example.com": { collections: { all: raw } } }));
  const { products, pageError } = await fourthwallAdapter.fetchCollection(url);
  expect(pageError).toBeNull();
  return products;
}

describe("the Fourthwall adapter follows the adapter contract", () => {
  it("has the adapter shape", () => {
    expectAdapterShape(fourthwallAdapter);
  });

  it("returns neutral products for the catalog", async () => {
    const products = await load(catalog());
    expect(products).toHaveLength(catalog().length);
    for (const p of products) expectNeutralProduct(p, fourthwallAdapter.capabilities);
  });

  it("returns neutral products for the edge cases the feed can send", async () => {
    const products = await load([
      // No variants at all.
      product({ handle: "no-variants", variants: [] }),
      // No image, no created_at, a non-USD currency.
      product({ handle: "bare", image: null, created_at: undefined, variants: [variant("S", { currency: "NZD", cents: 3500 })] }),
      // A date format we can't read, and a compare-at price below the price.
      product({ handle: "odd", created_at: "sometime", compare_at_price: "1.00", price: "20.00" }),
      // Titles that split differently for different variants.
      product({ handle: "ragged", variants: [variant("Black, XS"), variant("Black, Vintage Wash, S")] }),
      // Sold out.
      product({ handle: "sold-out", available: false }),
    ]);
    expect(products).toHaveLength(5);
    for (const p of products) expectNeutralProduct(p, fourthwallAdapter.capabilities);
  });

  it("returns neutral products when the shop is on a locale", async () => {
    const products = await load(catalog(), "https://shop.example.com/en-nzd/collections/all");
    for (const p of products) expectNeutralProduct(p, fourthwallAdapter.capabilities);
    expect(products[0].url).toContain("/en-nzd/products/");
  });
});
