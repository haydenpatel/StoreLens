import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCollectionJsonUrl,
  normalizeShopifyProduct,
  shopifyAdapter,
} from "./shopify";
import { loadCollectionsCache } from "@/lib/store";
import { collectionsPage, product, variant } from "../__fixtures__/shopify";

import { jsonResponse, memoryStorage } from "../__fixtures__/test-helpers";

const ORIGIN = "https://shop.example.com";

// Routes the two Shopify endpoints discovery uses. `listing` is a function of
// the page number returning a response or throwing; `allProducts` maps a
// handle to whether its /products.json?limit=1 probe returns a product.
function routedFetch({ listing, probes = {} }) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/collections.json")) {
      return listing(Number(u.searchParams.get("page")));
    }
    const m = u.pathname.match(/\/collections\/([^/]+)\/products\.json$/);
    if (m) {
      return probes[m[1]]
        ? jsonResponse({ products: [{ id: 1 }] })
        : jsonResponse({}, { ok: false, status: 404 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const probeUrls = (fetchMock) =>
  fetchMock.mock.calls.map(([url]) => url).filter((u) => u.includes("/products.json"));

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseUrl", () => {
  const parse = (path) => shopifyAdapter.parseUrl(new URL(`https://shop.example.com${path}`));

  it("returns the origin and the collection handle from /collections/<handle>", () => {
    expect(parse("/collections/tees")).toEqual({ origin: ORIGIN, collection: "tees" });
    expect(parse("/collections/tees/products.json").collection).toBe("tees");
    expect(parse("/collections/tees/").collection).toBe("tees");
  });

  it("returns a null collection for the root and non-collection paths", () => {
    expect(parse("/").collection).toBeNull();
    expect(parse("/products/tee").collection).toBeNull();
    expect(parse("/collections").collection).toBeNull();
  });

  it("keeps the port in the origin", () => {
    expect(shopifyAdapter.parseUrl(new URL("http://localhost:3000/collections/all"))).toEqual({
      origin: "http://localhost:3000",
      collection: "all",
    });
  });

  describe("locale prefixes (Shopify Markets)", () => {
    it("keeps the locale as part of the origin and finds the collection after it", () => {
      expect(parse("/en-nz/collections/all/products")).toEqual({
        origin: `${ORIGIN}/en-nz`,
        collection: "all",
      });
      expect(parse("/fr/collections/tees")).toEqual({ origin: `${ORIGIN}/fr`, collection: "tees" });
      expect(parse("/pt-br/collections/tees").origin).toBe(`${ORIGIN}/pt-br`);
    });

    it("accepts an upper-case locale", () => {
      expect(parse("/EN-NZ/collections/all").origin).toBe(`${ORIGIN}/EN-NZ`);
    });

    it("does not treat longer first segments as a locale", () => {
      expect(parse("/products/collections/tees")).toEqual({ origin: ORIGIN, collection: null });
      expect(parse("/shop/collections/tees")).toEqual({ origin: ORIGIN, collection: null });
    });

    it("treats a locale-only root as that market's bare store", () => {
      expect(parse("/en-nz")).toEqual({ origin: `${ORIGIN}/en-nz`, collection: null });
      expect(parse("/en-nz/")).toEqual({ origin: `${ORIGIN}/en-nz`, collection: null });
      expect(parse("/fr")).toEqual({ origin: `${ORIGIN}/fr`, collection: null });
    });

    it("does not treat other short root pages as a locale", () => {
      for (const path of ["/faq", "/shop", "/about", "/", "/en-nz/pages/about"]) {
        expect(parse(path).origin).toBe(ORIGIN);
      }
    });

    it("round-trips through collectionUrl so the locale carries into the request", () => {
      const { origin, collection } = parse("/en-nz/collections/all/products");
      const collectionUrl = shopifyAdapter.collectionUrl(origin, collection);
      expect(collectionUrl).toBe(`${ORIGIN}/en-nz/collections/all`);
      expect(getCollectionJsonUrl(collectionUrl)).toBe(`${ORIGIN}/en-nz/collections/all/products.json`);
    });
  });
});

describe("collectionUrl", () => {
  it("builds /collections/<handle> on the origin", () => {
    expect(shopifyAdapter.collectionUrl(ORIGIN, "tees")).toBe(`${ORIGIN}/collections/tees`);
  });
});

describe("getCollectionJsonUrl", () => {
  it("appends products.json to a collection URL", () => {
    expect(getCollectionJsonUrl("https://shop.example.com/collections/tees")).toBe(
      "https://shop.example.com/collections/tees/products.json"
    );
  });

  it("handles a trailing slash and drops the query string", () => {
    expect(getCollectionJsonUrl("https://shop.example.com/collections/tees/?sort=1")).toBe(
      "https://shop.example.com/collections/tees/products.json"
    );
  });

  it("keeps the host's port", () => {
    expect(getCollectionJsonUrl("http://localhost:3000/collections/all")).toBe(
      "http://localhost:3000/collections/all/products.json"
    );
  });

  it("throws the Shopify-specific message for non-collection or invalid URLs", () => {
    const message = "Please enter a valid Shopify collection URL";
    expect(() => getCollectionJsonUrl("https://shop.example.com/products/tee")).toThrow(message);
    expect(() => getCollectionJsonUrl("https://shop.example.com")).toThrow(message);
    expect(() => getCollectionJsonUrl("not a url")).toThrow(message);
  });
});

describe("normalizeShopifyProduct", () => {
  const normalize = (raw) => normalizeShopifyProduct(raw, "https://Shop.Example.com:8443");

  it("maps a raw product onto the neutral shape", () => {
    const raw = product({
      id: 7,
      title: "Acme Tee",
      handle: "acme-tee",
      body_html: "<p>Soft</p>",
      vendor: "Acme",
      product_type: "Shirts",
      tags: ["a", "b"],
      created_at: "2026-03-01T00:00:00-00:00",
      images: [{ src: "https://example.com/1.jpg" }, { src: "https://example.com/2.jpg" }],
      options: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Blue"] }],
      variants: [
        variant({ id: 1, title: "S / Blue", price: "20.00", compare_at_price: "25.00", option1: "S", option2: "Blue" }),
        variant({ id: 2, title: "M / Blue", price: "22.50", available: false, option1: "M", option2: "Blue" }),
      ],
    });

    expect(normalize(raw)).toEqual({
      id: 7,
      handle: "acme-tee",
      title: "Acme Tee",
      url: "https://shop.example.com/products/acme-tee",
      images: [{ url: "https://example.com/1.jpg" }, { url: "https://example.com/2.jpg" }],
      description: "<p>Soft</p>",
      vendors: ["Acme"],
      categories: ["Shirts"],
      tags: ["a", "b"],
      available: true,
      createdAt: "2026-03-01T00:00:00-00:00",
      variants: [
        { id: 1, title: "S / Blue", price: 20, compareAtPrice: 25, available: true, options: ["S", "Blue"] },
        { id: 2, title: "M / Blue", price: 22.5, compareAtPrice: null, available: false, options: ["M", "Blue"] },
      ],
      options: [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Blue"] },
      ],
    });
  });

  it("builds an https link on the hostname (no port), as before adapters", () => {
    expect(normalize(product({ handle: "x" })).url).toBe("https://shop.example.com/products/x");
  });

  it("has no link without a handle", () => {
    expect(normalize(product({ handle: "" })).url).toBeNull();
  });

  it("uses empty lists for missing vendor, product type and tags", () => {
    const n = normalize(product({ vendor: "", product_type: "", tags: undefined }));
    expect(n.vendors).toEqual([]);
    expect(n.categories).toEqual([]);
    expect(n.tags).toEqual([]);
  });

  it("is unavailable when no variant is available", () => {
    const n = normalize(product({ variants: [variant({ available: false })] }));
    expect(n.available).toBe(false);
  });

  it("drops trailing empty option slots", () => {
    const n = normalize(
      product({
        options: [{ name: "Size", values: ["S"] }],
        variants: [variant({ option1: "S", option2: null, option3: null })],
      })
    );
    expect(n.variants[0].options).toEqual(["S"]);
  });

  describe("the Title / Default Title placeholder option", () => {
    it("is dropped: the product has no real options", () => {
      const n = normalize(
        product({
          options: [{ name: "Title", values: ["Default Title"] }],
          variants: [variant({ title: "Default Title", option1: "Default Title" })],
        })
      );
      expect(n.options).toEqual([]);
      expect(n.variants[0].options).toEqual([]);
      // The variant itself is unchanged.
      expect(n.variants[0].title).toBe("Default Title");
    });

    it("is kept when Title has real values", () => {
      const n = normalize(
        product({
          options: [{ name: "Title", values: ["Hardback", "Paperback"] }],
          variants: [variant({ option1: "Hardback" })],
        })
      );
      expect(n.options).toEqual([{ name: "Title", values: ["Hardback", "Paperback"] }]);
      expect(n.variants[0].options).toEqual(["Hardback"]);
    });

    it("is kept when the product has other options too", () => {
      const n = normalize(
        product({
          options: [{ name: "Title", values: ["Default Title"] }, { name: "Size", values: ["S"] }],
          variants: [variant({ option1: "Default Title", option2: "S" })],
        })
      );
      expect(n.options.map((o) => o.name)).toEqual(["Title", "Size"]);
    });
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["zero (\"0.00\")", "0.00"],
    ["non-numeric", "n/a"],
  ])("treats a compare_at_price of %s as no compare price", (_label, value) => {
    const n = normalize(product({ variants: [variant({ compare_at_price: value })] }));
    expect(n.variants[0].compareAtPrice).toBeNull();
  });

  it("keeps a real compare_at_price", () => {
    const n = normalize(product({ variants: [variant({ compare_at_price: "12.50" })] }));
    expect(n.variants[0].compareAtPrice).toBe(12.5);
  });

  it("accepts tags as an array or a comma-separated string", () => {
    expect(normalize(product({ tags: ["a", "b"] })).tags).toEqual(["a", "b"]);
    expect(normalize(product({ tags: "summer, cotton ,, gift" })).tags).toEqual(["summer", "cotton", "gift"]);
    expect(normalize(product({ tags: "" })).tags).toEqual([]);
    expect(normalize(product({ tags: null })).tags).toEqual([]);
  });
});

describe("fetchCollection", () => {
  const COLLECTION = `${ORIGIN}/collections/tees`;
  const rawProducts = (n, start = 0) =>
    Array.from({ length: n }, (_, i) => product({ id: start + i, handle: `p-${start + i}` }));

  const pagedFetch = (pages) =>
    vi.fn(async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const body = pages[page - 1];
      if (body === undefined) return jsonResponse({ products: [] });
      if (body instanceof Error) throw body;
      if (typeof body === "number") return jsonResponse({}, { ok: false, status: body });
      return jsonResponse({ products: body });
    });

  it("requests pages of 250 from the collection's products.json", async () => {
    const fetchMock = pagedFetch([rawProducts(3)]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(fetchMock.mock.calls[0][0]).toBe(`${COLLECTION}/products.json?page=1&limit=250`);
    expect(result.products).toHaveLength(3);
    expect(result).toMatchObject({ pageError: null, truncated: false });
  });

  it("keeps a locale prefix in the request URL", async () => {
    const fetchMock = pagedFetch([rawProducts(1)]);
    vi.stubGlobal("fetch", fetchMock);

    await shopifyAdapter.fetchCollection(`${ORIGIN}/en-nz/collections/tees`);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/en-nz/collections/tees/products.json?page=1&limit=250`);
  });

  it("returns normalized products", async () => {
    vi.stubGlobal("fetch", pagedFetch([[product({ id: 1, handle: "tee", vendor: "Acme" })]]));
    const { products } = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(products[0]).toMatchObject({
      handle: "tee",
      vendors: ["Acme"],
      url: "https://shop.example.com/products/tee",
    });
  });

  it("keeps paging while pages are full and stops on a short page", async () => {
    const fetchMock = pagedFetch([rawProducts(250), rawProducts(250, 250), rawProducts(10, 500)]);
    vi.stubGlobal("fetch", fetchMock);

    const { products } = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(products).toHaveLength(510);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops on an empty page", async () => {
    const fetchMock = pagedFetch([rawProducts(250), []]);
    vi.stubGlobal("fetch", fetchMock);

    const { products } = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(products).toHaveLength(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps what loaded and reports the error when a later page fails", async () => {
    vi.stubGlobal("fetch", pagedFetch([rawProducts(250), 500]));

    const result = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(result.products).toHaveLength(250);
    expect(result.pageError.message).toBe("Failed to fetch page 2 (status 500)");
    expect(result.truncated).toBe(false);
  });

  it("reports a first-page failure with no products", async () => {
    vi.stubGlobal("fetch", pagedFetch([404]));

    const result = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(result.products).toEqual([]);
    expect(result.pageError.message).toBe("Failed to fetch page 1 (status 404)");
  });

  it("reports truncation when the page limit is reached with more to come", async () => {
    const fetchMock = pagedFetch([rawProducts(250), rawProducts(250, 250), rawProducts(250, 500)]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.fetchCollection(COLLECTION, { maxPages: 2 });
    expect(result.products).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("is not truncated when the last allowed page is short", async () => {
    vi.stubGlobal("fetch", pagedFetch([rawProducts(250), rawProducts(5, 250)]));
    const result = await shopifyAdapter.fetchCollection(COLLECTION, { maxPages: 2 });
    expect(result.truncated).toBe(false);
  });

  it("throws the Shopify URL error for a non-collection URL, before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(shopifyAdapter.fetchCollection(`${ORIGIN}/products/tee`)).rejects.toThrow(
      "Please enter a valid Shopify collection URL"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rethrows an abort instead of reporting it as a page error", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw abort;
      })
    );

    await expect(shopifyAdapter.fetchCollection(COLLECTION, { signal: controller.signal })).rejects.toBe(abort);
  });

  it("treats a failure while not aborted as a page error", async () => {
    vi.stubGlobal("fetch", pagedFetch([new Error("network down")]));
    const result = await shopifyAdapter.fetchCollection(COLLECTION);
    expect(result.pageError.message).toBe("network down");
  });
});

describe("listCollections when the first path segment may not be a locale", () => {
  const PLAIN = ORIGIN;
  const LOCALE = `${ORIGIN}/uk`;
  const tees = collectionsPage([["tees", "Tees", 5]]);

  // Serves /collections.json (and the all-products probes) only for the
  // origins marked as working; everything else is a 404.
  const storeFetch = ({ plainWorks = false, localeWorks = false, localeEmpty = false }) =>
    vi.fn(async (url) => {
      const u = new URL(url);
      const underLocale = u.pathname.startsWith("/uk/");
      if (u.pathname.endsWith("/collections.json")) {
        if (underLocale ? localeWorks : plainWorks) return jsonResponse(tees);
        if (underLocale && localeEmpty) return jsonResponse({ collections: [] });
      }
      return jsonResponse({}, { ok: false, status: 404 });
    });
  const calledUnderLocale = (fetchMock) =>
    fetchMock.mock.calls.some(([url]) => new URL(url).pathname.startsWith("/uk/"));

  it("uses the locale origin when it works, and never asks for the plain one", async () => {
    const fetchMock = storeFetch({ localeWorks: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(LOCALE);
    expect(result.collections.map((c) => c.handle)).toEqual(["tees"]);
    expect(result.origin).toBeUndefined();
    expect(fetchMock.mock.calls.every(([url]) => new URL(url).pathname.startsWith("/uk/"))).toBe(true);
  });

  it("falls back to the plain origin when the locale one has nothing, and says so", async () => {
    vi.stubGlobal("fetch", storeFetch({ plainWorks: true }));

    const result = await shopifyAdapter.listCollections(LOCALE);
    expect(result.origin).toBe(PLAIN);
    expect(result.collections.map((c) => c.handle)).toEqual(["tees"]);
    expect(loadCollectionsCache("shopify", PLAIN)).not.toBeNull();
  });

  it("falls back when the locale origin answers with an empty listing", async () => {
    vi.stubGlobal("fetch", storeFetch({ plainWorks: true, localeEmpty: true }));
    const result = await shopifyAdapter.listCollections(LOCALE);
    expect(result.origin).toBe(PLAIN);
  });

  it("throws the locale origin's error when neither origin works", async () => {
    vi.stubGlobal("fetch", storeFetch({}));
    await expect(shopifyAdapter.listCollections(LOCALE)).rejects.toThrow(
      "Failed to fetch collections (status 404)"
    );
  });

  it("never tries a locale for a plain origin", async () => {
    const fetchMock = storeFetch({ plainWorks: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(PLAIN);
    expect(result.origin).toBeUndefined();
    expect(calledUnderLocale(fetchMock)).toBe(false);
  });

  it("rethrows an abort instead of falling back", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));
    await expect(shopifyAdapter.listCollections(LOCALE)).rejects.toBe(abort);
  });
});

describe("shopifyAdapter metadata", () => {
  it("exposes normalize, which maps a raw product to the neutral shape", () => {
    const n = shopifyAdapter.normalize(product({ handle: "tee", vendor: "Acme" }), ORIGIN);
    expect(n).toMatchObject({ handle: "tee", vendors: ["Acme"] });
  });

  it("labels its filter sections", () => {
    expect(shopifyAdapter.labels).toEqual({ vendors: "Vendor", categories: "Product Type" });
  });

  it("identifies itself and supports every capability", () => {
    expect(shopifyAdapter.id).toBe("shopify");
    expect(shopifyAdapter.name).toBe("Shopify");
    expect(Object.values(shopifyAdapter.capabilities).every(Boolean)).toBe(true);
  });
});

describe("listCollections", () => {
  it("lists collections, drops empty ones and sorts by title", async () => {
    const fetchMock = routedFetch({
      listing: (page) =>
        jsonResponse(
          page === 1
            ? collectionsPage([
                ["zeta", "Zeta", 4],
                ["empty", "Empty", 0],
                ["alpha", "alpha", 2],
                ["Beta", "Beta", 9],
              ])
            : { collections: [] }
        ),
      probes: { all: false },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.collections.map((c) => c.handle)).toEqual(["alpha", "Beta", "zeta"]);
    expect(result.allProductsHandle).toBeNull();
  });

  it("prepends a probed all-products collection that the listing omits", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch({
        listing: () => jsonResponse(collectionsPage([["tees", "Tees", 5]])),
        probes: { all: true },
      })
    );

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.collections[0]).toEqual({ handle: "all", title: "All Products", products_count: null });
    expect(result.collections.map((c) => c.handle)).toEqual(["all", "tees"]);
    expect(result.allProductsHandle).toBe("all");
  });

  it("skips probing when the listing already contains the all-products handle", async () => {
    const fetchMock = routedFetch({
      listing: () => jsonResponse(collectionsPage([["all", "All", 50], ["tees", "Tees", 5]])),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(probeUrls(fetchMock)).toEqual([]);
    expect(result.allProductsHandle).toBe("all");
  });

  it("tries known handles in order and stops at the first that has products", async () => {
    const fetchMock = routedFetch({
      listing: () => jsonResponse({ collections: [] }),
      probes: { "all-products": true, everything: true },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.allProductsHandle).toBe("all-products");
    expect(probeUrls(fetchMock).map((u) => new URL(u).pathname)).toEqual([
      "/collections/all/products.json",
      "/collections/all-products/products.json",
    ]);
  });

  it("sorts the all-products handles first, in their priority order", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch({
        listing: () =>
          jsonResponse(collectionsPage([["aardvark", "Aardvark", 1], ["shop-all", "Shop All", 9], ["all-products", "AP", 9]])),
      })
    );

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.collections.map((c) => c.handle)).toEqual(["all-products", "shop-all", "aardvark"]);
    expect(result.allProductsHandle).toBe("all-products");
  });

  it("falls back to probing when /collections.json is blocked", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch({
        listing: () => jsonResponse({}, { ok: false, status: 403 }),
        probes: { "shop-all": true },
      })
    );

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.collections.map((c) => c.handle)).toEqual(["shop-all"]);
    expect(result.allProductsHandle).toBe("shop-all");
  });

  it("throws the listing error when the listing fails and no probe finds anything", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch({ listing: () => jsonResponse({}, { ok: false, status: 500 }) })
    );

    await expect(shopifyAdapter.listCollections(ORIGIN)).rejects.toThrow("Failed to fetch collections (status 500)");
  });

  it("returns an empty result (not an error) when the listing works but is empty", async () => {
    vi.stubGlobal("fetch", routedFetch({ listing: () => jsonResponse({ collections: [] }) }));
    await expect(shopifyAdapter.listCollections(ORIGIN)).resolves.toEqual({
      collections: [],
      allProductsHandle: null,
    });
  });

  it("follows pagination while pages are full (250) and stops on a short page", async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({ handle: `c${i}`, title: `C${i}`, products_count: 1 }));
    const fetchMock = routedFetch({
      listing: (page) => jsonResponse({ collections: page === 1 ? full : [{ handle: "last", title: "Last", products_count: 1 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.collections).toHaveLength(251);
    const listingCalls = fetchMock.mock.calls.filter(([u]) => u.includes("/collections.json"));
    expect(listingCalls).toHaveLength(2);
    expect(listingCalls[0][0]).toContain("limit=250&page=1");
  });

  it("stops if a page repeats the previous one (guards against ignored page params)", async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({ handle: `c${i}`, title: `C${i}`, products_count: 1 }));
    const fetchMock = routedFetch({ listing: () => jsonResponse({ collections: full }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await shopifyAdapter.listCollections(ORIGIN);
    expect(result.collections).toHaveLength(250);
    expect(fetchMock.mock.calls.filter(([u]) => u.includes("/collections.json"))).toHaveLength(2);
  });

  it("discovers and caches collections per locale origin", async () => {
    const localeOrigin = `${ORIGIN}/en-nz`;
    const fetchMock = routedFetch({
      listing: () => jsonResponse(collectionsPage([["tees", "Tees", 5]])),
    });
    vi.stubGlobal("fetch", fetchMock);

    await shopifyAdapter.listCollections(localeOrigin);
    expect(fetchMock.mock.calls[0][0]).toContain(`${localeOrigin}/collections.json`);
    expect(loadCollectionsCache("shopify", localeOrigin)).not.toBeNull();
    expect(loadCollectionsCache("shopify", ORIGIN)).toBeNull();
  });

  it("caches results and serves the cache until forceRefresh", async () => {
    const fetchMock = routedFetch({
      listing: () => jsonResponse(collectionsPage([["tees", "Tees", 5]])),
    });
    vi.stubGlobal("fetch", fetchMock);

    await shopifyAdapter.listCollections(ORIGIN);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await shopifyAdapter.listCollections(ORIGIN);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    await shopifyAdapter.listCollections(ORIGIN, undefined, { forceRefresh: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("propagates an abort and does not cache a partial result", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));

    await expect(shopifyAdapter.listCollections(ORIGIN)).rejects.toBe(abort);
    expect(loadCollectionsCache("shopify", ORIGIN)).toBeNull();
  });

  it("propagates an abort that happens during probing", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url.includes("/collections.json")) return jsonResponse({ collections: [] });
        throw abort;
      })
    );

    await expect(shopifyAdapter.listCollections(ORIGIN)).rejects.toBe(abort);
    expect(loadCollectionsCache("shopify", ORIGIN)).toBeNull();
  });
});
