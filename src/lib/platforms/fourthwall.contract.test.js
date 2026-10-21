import { afterEach, describe, expect, it, vi } from "vitest";
import { fourthwallAdapter } from "./fourthwall";
import { expectAdapterShape, expectNeutralProduct, expectParseUrl } from "../__fixtures__/adapter-contract";
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

  it("reads store, collection, locale and product URLs like every other adapter", () => {
    expectParseUrl(fourthwallAdapter, {
      origin: "https://shop.example.com",
      root: "https://shop.example.com/",
      collection: { url: "https://shop.example.com/collections/tees", handle: "tees" },
      product: "https://shop.example.com/products/example-tee",
      locale: { url: "https://shop.example.com/en-nzd/collections/tees", origin: "https://shop.example.com/en-nzd", handle: "tees" },
    });
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
      // An absolute url, string cents and no availability field.
      product({ handle: "loose", url: "https://shop.example.com/products/loose", available: undefined, variants: [{ id: "v", title: "S", price: { cents: "1500", currency_iso: "USD" } }] }),
      // A null product and a null variant.
      null,
      product({ handle: "holes", variants: [null, variant("S")] }),
    ]);
    expect(products).toHaveLength(7);
    for (const p of products) expectNeutralProduct(p, fourthwallAdapter.capabilities);
  });

  it("returns neutral products when the shop is on a locale", async () => {
    const products = await load(catalog(), "https://shop.example.com/en-nzd/collections/all");
    for (const p of products) expectNeutralProduct(p, fourthwallAdapter.capabilities);
    expect(products[0].url).toContain("/en-nzd/products/");
  });
});
