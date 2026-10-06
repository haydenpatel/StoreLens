import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bigcartelAdapter, clearFeedCache, normalizeBigCartelProduct } from "./bigcartel";
import { catalog, category, option, optionGroup, product, sized } from "../__fixtures__/bigcartel";
import { fakeBigCartelFetch } from "../__fixtures__/fake-bigcartel-fetch";
import { jsonResponse } from "../__fixtures__/test-helpers";

const ORIGIN = "https://example-shop.bigcartel.com";
const url = (u) => new URL(u);
const parse = (u) => bigcartelAdapter.parseUrl(url(u));
// The requests a fake fetch saw for one of the shop's two documents.
const requested = (fetchMock, document) => fetchMock.calls.filter((u) => u.pathname.endsWith(`/${document}.json`));
const stubShop = (raw = catalog(), override, options) => {
  const fetchMock = fakeBigCartelFetch({ "example-shop": raw }, override, options);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

beforeEach(() => {
  clearFeedCache();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("matchesUrl", () => {
  it("claims a shop's *.bigcartel.com address", () => {
    expect(bigcartelAdapter.matchesUrl(url(ORIGIN))).toBe(true);
    expect(bigcartelAdapter.matchesUrl(url(`${ORIGIN}/category/tees`))).toBe(true);
    expect(bigcartelAdapter.matchesUrl(url("https://EXAMPLE-SHOP.bigcartel.com"))).toBe(true);
  });

  it("does not claim Big Cartel's own sites, nested hosts or other domains", () => {
    for (const u of ["https://www.bigcartel.com", "https://api.bigcartel.com/x/products.json", "https://bigcartel.com", "https://a.b.bigcartel.com", "https://shop.example.com", "https://example-shop.bigcartel.com.example.com"]) {
      expect(bigcartelAdapter.matchesUrl(url(u)), u).toBe(false);
    }
  });
});

describe("parseUrl and collectionUrl", () => {
  it("reads a category from /category/<permalink>", () => {
    expect(parse(`${ORIGIN}/category/tees`)).toEqual({ origin: ORIGIN, collection: "tees" });
    expect(parse(`${ORIGIN}/category/tees/`)).toEqual({ origin: ORIGIN, collection: "tees" });
    expect(parse(`${ORIGIN}/category/art%20prints`)).toEqual({ origin: ORIGIN, collection: "art prints" });
  });

  it("reads the product listing as the all-products collection", () => {
    expect(parse(`${ORIGIN}/products`)).toEqual({ origin: ORIGIN, collection: "all" });
    expect(parse(`${ORIGIN}/products.json`)).toEqual({ origin: ORIGIN, collection: "all" });
  });

  it("returns a null collection for the root, a product page and other pages", () => {
    expect(parse(ORIGIN)).toEqual({ origin: ORIGIN, collection: null });
    expect(parse(`${ORIGIN}/product/example-tee`)).toEqual({ origin: ORIGIN, collection: null });
    expect(parse(`${ORIGIN}/about`)).toEqual({ origin: ORIGIN, collection: null });
    expect(parse(`${ORIGIN}/category/tees/extra`)).toEqual({ origin: ORIGIN, collection: null });
  });

  it("builds URLs that parse back to the same collection", () => {
    for (const handle of ["all", "tees", "art prints", "a/b"]) {
      expect(parse(bigcartelAdapter.collectionUrl(ORIGIN, handle)).collection).toBe(handle);
    }
    expect(bigcartelAdapter.collectionUrl(ORIGIN, "all")).toBe(`${ORIGIN}/products`);
    expect(bigcartelAdapter.collectionUrl(ORIGIN, "tees")).toBe(`${ORIGIN}/category/tees`);
  });
});

describe("metadata", () => {
  it("names vendors Artists and has no tags", () => {
    expect(bigcartelAdapter.labels).toEqual({ vendors: "Artists", categories: "Category" });
    expect(bigcartelAdapter.capabilities.tags).toBe(false);
    expect(bigcartelAdapter.capabilities.collectionDiscovery).toBe(true);
    expect(bigcartelAdapter.detect).toBeUndefined();
  });
});

describe("normalizeBigCartelProduct", () => {
  it("maps a product with two option groups, by group position", () => {
    const [tee] = catalog();
    const p = normalizeBigCartelProduct(tee, ORIGIN);
    expect(p).toMatchObject({
      handle: "example-tee",
      title: "Example Tee",
      url: `${ORIGIN}/product/example-tee`,
      vendors: ["Example Artist"],
      categories: ["Tees"],
      tags: [],
      available: true,
      createdAt: "2026-09-28T18:59:56.000+02:00",
      description: "<p>An invented product.</p>",
    });
    expect(p.options).toEqual([
      { name: "Size", values: ["S", "M"] },
      { name: "Colour", values: ["Black", "White"] },
    ]);
    expect(p.variants.map((v) => v.options)).toEqual([["S", "Black"], ["M", "Black"], ["S", "White"], ["M", "White"]]);
    expect(p.variants[0].title).toBe("Black / S");
  });

  it("names options as the shop wrote them", () => {
    const p = normalizeBigCartelProduct(sized({}, ["S"]), ORIGIN);
    expect(p.options).toEqual([{ name: "Size", values: ["S"] }]);
  });

  it("gives a product with no option groups no options and a blank variant title", () => {
    const [, , , sticker] = catalog();
    const p = normalizeBigCartelProduct(sticker, ORIGIN);
    expect(p.options).toEqual([]);
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0]).toMatchObject({ title: "", options: [], price: 5, available: true });
  });

  it("takes availability from each option, and the product's status", () => {
    const part = normalizeBigCartelProduct(sized({}, ["S", "M"], { soldOut: ["S"] }), ORIGIN);
    expect(part.variants.map((v) => v.available)).toEqual([false, true]);
    expect(part.available).toBe(true);

    const all = normalizeBigCartelProduct(sized({}, ["S", "M"], { soldOut: ["S", "M"] }), ORIGIN);
    expect(all.available).toBe(false);

    const status = normalizeBigCartelProduct(sized({ status: "sold-out" }, ["S"]), ORIGIN);
    expect(status.available).toBe(false);
  });

  it("is not available without options", () => {
    expect(normalizeBigCartelProduct(product({ options: [] }), ORIGIN).available).toBe(false);
  });

  it("uses each option's own price", () => {
    const group = optionGroup("Size", ["S", "XL"]);
    const p = normalizeBigCartelProduct(
      product({ option_groups: [group], options: [option("S", { price: 20, values: [group.values[0]] }), option("XL", { price: 24, values: [group.values[1]] })] }),
      ORIGIN
    );
    expect(p.variants.map((v) => v.price)).toEqual([20, 24]);
  });

  describe("compare-at price", () => {
    it("is the base price when on sale and the option costs less", () => {
      const [, hoodie] = catalog();
      expect(normalizeBigCartelProduct(hoodie, ORIGIN).variants.map((v) => v.compareAtPrice)).toEqual([55, 55]);
    });

    it("is null when the on_sale flag is set but nothing is discounted", () => {
      expect(normalizeBigCartelProduct(product({ on_sale: true }), ORIGIN).variants[0].compareAtPrice).toBeNull();
    });

    it("is null when the flag is off, even if an option is cheaper than the base price", () => {
      const p = product({ on_sale: false, default_price: 20, options: [option("Early", { price: 18 })] });
      expect(normalizeBigCartelProduct(p, ORIGIN).variants[0].compareAtPrice).toBeNull();
    });
  });

  it("lists every category and artist, and drops blank names", () => {
    const p = normalizeBigCartelProduct(
      product({ categories: [category("A"), category("B"), { name: " " }], artists: [{ name: "X" }, { name: "" }, null] }),
      ORIGIN
    );
    expect(p.categories).toEqual(["A", "B"]);
    expect(p.vendors).toEqual(["X"]);
  });

  it("prefers an image's secure_url and skips ones with no address", () => {
    const p = normalizeBigCartelProduct(
      product({ images: [{ url: "http://example.com/a.png", secure_url: "https://example.com/a.png" }, { url: "https://example.com/b.png" }, {}] }),
      ORIGIN
    );
    expect(p.images).toEqual([{ url: "https://example.com/a.png" }, { url: "https://example.com/b.png" }]);
  });

  it("builds the product link from the permalink, on the singular /product/ path", () => {
    expect(normalizeBigCartelProduct(product({ permalink: "a-b" }), ORIGIN).url).toBe(`${ORIGIN}/product/a-b`);
    expect(normalizeBigCartelProduct(product({ permalink: "" }), ORIGIN).url).toBeNull();
  });

  it("copes with missing optional fields", () => {
    const p = normalizeBigCartelProduct({ id: 1, name: "Bare", permalink: "bare", price: 3 }, ORIGIN);
    expect(p).toMatchObject({ handle: "bare", images: [], vendors: [], categories: [], variants: [], options: [], available: false });
    expect(p.description).toBeUndefined();
    expect(p.createdAt).toBeUndefined();
  });

  it("drops a created_at it can't read", () => {
    expect(normalizeBigCartelProduct(product({ created_at: "last week" }), ORIGIN).createdAt).toBeUndefined();
  });
});

describe("fetchCollection", () => {
  it("loads every product from the shop's feed in one request, with its store info beside it", async () => {
    const fetchMock = stubShop();
    const progress = vi.fn();
    const result = await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`, { onProgress: progress });
    expect(result.products).toHaveLength(4);
    expect(result).toMatchObject({ pageError: null, truncated: false });
    expect(fetchMock.calls.map(String).sort()).toEqual([
      "https://api.bigcartel.com/example-shop/products.json",
      "https://api.bigcartel.com/example-shop/store.json",
    ]);
    expect(progress).toHaveBeenCalledWith({ loaded: 4 });
  });

  it("loads only a category's products", async () => {
    stubShop();
    const { products } = await bigcartelAdapter.fetchCollection(`${ORIGIN}/category/art-prints`);
    expect(products.map((p) => p.handle)).toEqual(["example-print"]);
  });

  it("matches a category's permalink without regard to case", async () => {
    stubShop();
    const { products } = await bigcartelAdapter.fetchCollection(`${ORIGIN}/category/TEES`);
    expect(products).toHaveLength(3);
  });

  it("reports a category the shop doesn't have as not found", async () => {
    stubShop();
    const { products, pageError } = await bigcartelAdapter.fetchCollection(`${ORIGIN}/category/nope`);
    expect(products).toEqual([]);
    expect(pageError).toMatchObject({ name: "StoreError", kind: "not-found" });
  });

  it("returns no error and no products for a shop with an empty feed", async () => {
    stubShop([]);
    const result = await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    expect(result).toMatchObject({ products: [], pageError: null });
  });

  it("rejects a URL that isn't a shop page", async () => {
    stubShop();
    await expect(bigcartelAdapter.fetchCollection(`${ORIGIN}/about`)).rejects.toThrow(/valid Big Cartel/);
    await expect(bigcartelAdapter.fetchCollection("https://shop.example.com/products")).rejects.toThrow(/valid Big Cartel/);
  });

  it("skips entries that aren't objects", async () => {
    stubShop([null, "x", product({ permalink: "ok" })]);
    const { products } = await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    expect(products.map((p) => p.handle)).toEqual(["ok"]);
  });

  describe("failures", () => {
    const kindOf = async (fetchOptions, shop = "example-shop", override) => {
      vi.stubGlobal("fetch", fakeBigCartelFetch({ "example-shop": catalog() }, override, fetchOptions));
      const { products, pageError } = await bigcartelAdapter.fetchCollection(`https://${shop}.bigcartel.com/products`);
      expect(products).toEqual([]);
      return pageError;
    };

    it("reports a closed or missing shop (404) as a missing store, not a missing collection, with no probe", async () => {
      const err = await kindOf({}, "gone-shop");
      expect(err).toMatchObject({ kind: "store-not-found", status: 404 });
    });

    it("reports a locked shop (403)", async () => {
      expect(await kindOf({ locked: ["example-shop"] })).toMatchObject({ kind: "locked", status: 403 });
    });

    it("reports a request that threw as blocked or offline", async () => {
      expect(await kindOf({}, "example-shop", () => Promise.reject(new TypeError("Failed to fetch")))).toMatchObject({
        kind: "blocked-or-offline",
      });
    });

    it("reports a body that isn't JSON, or isn't an array, as an unsupported platform", async () => {
      const notJson = { ok: true, status: 200, json: async () => JSON.parse("<html>") };
      expect(await kindOf({}, "example-shop", () => notJson)).toMatchObject({ kind: "unsupported-platform" });
      expect(await kindOf({}, "example-shop", () => jsonResponse({ products: [] }))).toMatchObject({ kind: "unsupported-platform" });
    });

    it("retries a 429, then reports it", async () => {
      const respond = vi.fn((u) => (u.pathname.endsWith("/products.json") ? jsonResponse({}, { ok: false, status: 429 }) : undefined));
      vi.stubGlobal("fetch", fakeBigCartelFetch({ "example-shop": catalog() }, respond));
      const pending = bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
      await vi.runAllTimersAsync();
      expect((await pending).pageError).toMatchObject({ kind: "rate-limited" });
      expect(respond.mock.calls.filter(([u]) => u.pathname.endsWith("/products.json"))).toHaveLength(3);
    });

    it("rethrows an abort", async () => {
      stubShop(catalog(), undefined, { honorAbort: true });
      const controller = new AbortController();
      const pending = bigcartelAdapter.fetchCollection(`${ORIGIN}/products`, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});

describe("the shop's currency", () => {
  const load = async (stores, url = `${ORIGIN}/products`) => {
    vi.stubGlobal("fetch", fakeBigCartelFetch({ "example-shop": catalog() }, undefined, { stores: { "example-shop": stores } }));
    return bigcartelAdapter.fetchCollection(url);
  };

  it("is set on every product, from store.json", async () => {
    for (const code of ["EUR", "GBP", "USD"]) {
      clearFeedCache();
      const { products } = await load({ currency: code });
      expect(products.map((p) => p.currency)).toEqual(Array(4).fill(code));
    }
  });

  it("is set for a category's products too", async () => {
    const { products } = await load({ currency: "EUR" }, `${ORIGIN}/category/tees`);
    expect(products).toHaveLength(3);
    expect(products.every((p) => p.currency === "EUR")).toBe(true);
  });

  it("is left unset, so prices fall back to the default, when store.json is unavailable", async () => {
    const { products, pageError } = await load(null);
    expect(pageError).toBeNull();
    expect(products).toHaveLength(4);
    expect(products.every((p) => p.currency === undefined)).toBe(true);
  });

  it.each([
    ["a lower-case code", "eur"],
    ["a name instead of a code", "Euro"],
    ["a number", 978],
    ["nothing", undefined],
  ])("is left unset for %s", async (_, code) => {
    vi.stubGlobal(
      "fetch",
      fakeBigCartelFetch({ "example-shop": catalog() }, (u) =>
        u.pathname.endsWith("/store.json") ? jsonResponse({ products_count: 4, currency: { code } }) : undefined
      )
    );
    const { products } = await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    expect(products.every((p) => p.currency === undefined)).toBe(true);
  });

  it("does not hold the products up for a store.json that never answers", async () => {
    vi.stubGlobal(
      "fetch",
      fakeBigCartelFetch({ "example-shop": catalog() }, (u) => (u.pathname.endsWith("/store.json") ? new Promise(() => {}) : undefined), {
        honorAbort: true,
      })
    );
    let result;
    const pending = bigcartelAdapter.fetchCollection(`${ORIGIN}/products`).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(result.pageError).toBeNull();
    expect(result.products).toHaveLength(4);
    expect(result.products.every((p) => p.currency === undefined)).toBe(true);
  });

  it("does not stop products loading when store.json throws, is locked or isn't JSON", async () => {
    const failures = [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => jsonResponse({}, { ok: false, status: 403 }),
      () => ({ ok: true, status: 200, json: async () => JSON.parse("<html>") }),
      () => jsonResponse("not an object"),
      () => jsonResponse(null),
    ];
    for (const fail of failures) {
      clearFeedCache();
      vi.stubGlobal("fetch", fakeBigCartelFetch({ "example-shop": catalog() }, (u) => (u.pathname.endsWith("/store.json") ? fail() : undefined)));
      const { products, pageError } = await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
      expect(pageError).toBeNull();
      expect(products).toHaveLength(4);
    }
  });
});

describe("a feed cut short", () => {
  const load = async (stores, url = `${ORIGIN}/products`) => {
    vi.stubGlobal("fetch", fakeBigCartelFetch({ "example-shop": catalog() }, undefined, { stores: { "example-shop": stores } }));
    return bigcartelAdapter.fetchCollection(url);
  };

  it("is reported as truncated when fewer products load than the shop has", async () => {
    const result = await load({ products_count: 250 });
    expect(result.products).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });

  it("is not reported when the count matches", async () => {
    expect((await load({ products_count: 4 })).truncated).toBe(false);
  });

  it("is not reported when the count is lower than what loaded, or 0, as one shop's is", async () => {
    expect((await load({ products_count: 3 })).truncated).toBe(false);
    clearFeedCache();
    expect((await load({ products_count: 0 })).truncated).toBe(false);
  });

  it("is not reported without a usable count", async () => {
    expect((await load(null)).truncated).toBe(false);
    clearFeedCache();
    expect((await load({ products_count: "250" })).truncated).toBe(false);
    clearFeedCache();
    expect((await load({ products_count: 12.5 })).truncated).toBe(false);
  });

  it("is not reported for a category, since the count is for the whole shop", async () => {
    const result = await load({ products_count: 250 }, `${ORIGIN}/category/tees`);
    expect(result.products).toHaveLength(3);
    expect(result.truncated).toBe(false);
  });

  it("is not reported when the load failed", async () => {
    vi.stubGlobal("fetch", fakeBigCartelFetch({}));
    const result = await bigcartelAdapter.fetchCollection("https://gone-shop.bigcartel.com/products");
    expect(result.truncated).toBe(false);
  });
});

describe("listCollections", () => {
  it("lists All Products first, then the categories in use, with counts", async () => {
    stubShop();
    const result = await bigcartelAdapter.listCollections(ORIGIN);
    expect(result).toEqual({
      allProductsHandle: "all",
      collections: [
        { handle: "all", title: "All Products", products_count: 4 },
        { handle: "art-prints", title: "Art Prints", products_count: 1 },
        { handle: "tees", title: "Tees", products_count: 3 },
      ],
    });
  });

  it("offers just All Products for a shop with no categories", async () => {
    stubShop([product()]);
    const { collections, allProductsHandle } = await bigcartelAdapter.listCollections(ORIGIN);
    expect(collections).toEqual([{ handle: "all", title: "All Products", products_count: 1 }]);
    expect(allProductsHandle).toBe("all");
  });

  it("counts a product once per category even if the feed repeats it", async () => {
    const tees = category("Tees");
    stubShop([product({ categories: [tees, tees] })]);
    const { collections } = await bigcartelAdapter.listCollections(ORIGIN);
    expect(collections[1]).toMatchObject({ handle: "tees", products_count: 1 });
  });

  it("leaves out a category whose permalink would clash with All Products", async () => {
    const all = category("All", "all");
    stubShop([product({ categories: [all, category("Tees")] }), product({ categories: [category("ALL", "ALL")] })]);
    const { collections } = await bigcartelAdapter.listCollections(ORIGIN);
    expect(collections.map((c) => c.handle)).toEqual(["all", "tees"]);
    expect(collections[0]).toMatchObject({ title: "All Products", products_count: 2 });
  });

  it("throws the failure, so the page can explain it", async () => {
    vi.stubGlobal("fetch", fakeBigCartelFetch({}));
    await expect(bigcartelAdapter.listCollections("https://gone-shop.bigcartel.com")).rejects.toMatchObject({ kind: "store-not-found" });
  });

  it("throws for an address that isn't a shop", async () => {
    stubShop();
    await expect(bigcartelAdapter.listCollections("https://shop.example.com")).rejects.toMatchObject({ kind: "unsupported-platform" });
  });
});

describe("the shared feed", () => {
  it("is requested once for discovery and the load that follows", async () => {
    const fetchMock = stubShop();
    await bigcartelAdapter.listCollections(ORIGIN);
    await bigcartelAdapter.fetchCollection(`${ORIGIN}/category/tees`);
    await Promise.all([bigcartelAdapter.fetchCollection(`${ORIGIN}/products`), bigcartelAdapter.listCollections(ORIGIN)]);
    expect(requested(fetchMock, "products")).toHaveLength(1);
    expect(requested(fetchMock, "store")).toHaveLength(1);
  });

  it("is requested again after it goes stale", async () => {
    const fetchMock = stubShop();
    await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    vi.advanceTimersByTime(31_000);
    await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    expect(requested(fetchMock, "products")).toHaveLength(2);
    expect(requested(fetchMock, "store")).toHaveLength(2);
  });

  it("is requested again on a forced refresh", async () => {
    const fetchMock = stubShop();
    await bigcartelAdapter.listCollections(ORIGIN);
    await bigcartelAdapter.listCollections(ORIGIN, undefined, { forceRefresh: true });
    expect(requested(fetchMock, "products")).toHaveLength(2);
  });

  it("is kept per shop", async () => {
    const fetchMock = fakeBigCartelFetch({ "example-shop": catalog(), "other-shop": [product()] });
    vi.stubGlobal("fetch", fetchMock);
    await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    const other = await bigcartelAdapter.fetchCollection("https://other-shop.bigcartel.com/products");
    expect(other.products).toHaveLength(1);
    expect(requested(fetchMock, "products")).toHaveLength(2);
  });

  it("does not keep a failure", async () => {
    let fail = true;
    const fetchMock = stubShop(catalog(), () => (fail ? jsonResponse({}, { ok: false, status: 403 }) : undefined));
    expect((await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`)).pageError).toMatchObject({ kind: "locked" });
    fail = false;
    expect((await bigcartelAdapter.fetchCollection(`${ORIGIN}/products`)).products).toHaveLength(4);
    expect(requested(fetchMock, "products")).toHaveLength(2);
  });

  it("lets one caller abort without failing the other waiting on the same request", async () => {
    stubShop(catalog(), undefined, { honorAbort: true });
    const controller = new AbortController();
    const first = bigcartelAdapter.fetchCollection(`${ORIGIN}/products`, { signal: controller.signal });
    const second = bigcartelAdapter.fetchCollection(`${ORIGIN}/products`);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect((await second).products).toHaveLength(4);
  });
});
