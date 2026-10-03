import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  discoverCollections,
  extractCollectionHandle,
  getDisplayHost,
  getOrigin,
  loadCollectionsCache,
  parseUserInputToURL,
  saveCollectionsCache,
} from "./store";
import { collectionsPage } from "./__fixtures__/shopify";

const ORIGIN = "https://shop.example.com";
const TTL_MS = 21600000; // 6 hours, mirrors store.js

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    _data: data,
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body };
}

// Routes the two Shopify endpoints discovery uses. `listing` is a function of
// the page number returning a response or throwing; `allProducts` maps a
// handle to whether its /products.json?limit=1 probe returns a product.
function routedFetch({ listing, probes = {} }) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    if (u.pathname === "/collections.json") {
      return listing(Number(u.searchParams.get("page")));
    }
    const m = u.pathname.match(/^\/collections\/([^/]+)\/products\.json$/);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseUserInputToURL", () => {
  it("adds https:// to a bare domain and trims whitespace", () => {
    expect(parseUserInputToURL("  shop.example.com  ").href).toBe("https://shop.example.com/");
  });

  it("keeps an explicit http or https scheme and path", () => {
    expect(parseUserInputToURL("http://shop.example.com/collections/tees").href).toBe(
      "http://shop.example.com/collections/tees"
    );
  });

  it("returns null for empty, whitespace-only or unparseable input", () => {
    expect(parseUserInputToURL("")).toBeNull();
    expect(parseUserInputToURL("   ")).toBeNull();
    expect(parseUserInputToURL(undefined)).toBeNull();
    expect(parseUserInputToURL(null)).toBeNull();
    expect(parseUserInputToURL("http://")).toBeNull();
  });
});

describe("getOrigin / getDisplayHost", () => {
  const url = new URL("https://Shop.Example.com:8443/collections/tees?x=1");

  it("returns the origin and host (host keeps the port, lowercased)", () => {
    expect(getOrigin(url)).toBe("https://shop.example.com:8443");
    expect(getDisplayHost(url)).toBe("shop.example.com:8443");
  });
});

describe("extractCollectionHandle", () => {
  const handleOf = (path) => extractCollectionHandle(new URL(`https://shop.example.com${path}`));

  it("extracts the handle from /collections/<handle>", () => {
    expect(handleOf("/collections/tees")).toBe("tees");
    expect(handleOf("/collections/tees/products.json")).toBe("tees");
    expect(handleOf("/collections/tees/")).toBe("tees");
  });

  it("returns null for the root and non-collection paths", () => {
    expect(handleOf("/")).toBeNull();
    expect(handleOf("/products/tee")).toBeNull();
    expect(handleOf("/collections")).toBeNull();
  });

  // Pinned current behaviour: only a leading /collections/ matches, so a
  // locale-prefixed path is not recognised. Platform adapters (#22) must
  // handle locale prefixes themselves.
  it("does not recognise a locale-prefixed collection path", () => {
    expect(handleOf("/en-nzd/collections/all")).toBeNull();
  });
});

describe("collections cache", () => {
  const cacheKey = `storelens:collections:v2:${ORIGIN}`;

  it("round-trips collections and the all-products handle", () => {
    saveCollectionsCache(ORIGIN, [{ handle: "all", title: "All", products_count: 3 }], "all");
    expect(loadCollectionsCache(ORIGIN)).toEqual({
      collections: [{ handle: "all", title: "All", products_count: 3 }],
      allProductsHandle: "all",
    });
  });

  it("defaults allProductsHandle to null", () => {
    saveCollectionsCache(ORIGIN, [], undefined);
    expect(loadCollectionsCache(ORIGIN)).toEqual({ collections: [], allProductsHandle: null });
  });

  it("is keyed per origin and cache version", () => {
    saveCollectionsCache(ORIGIN, [], null);
    expect(localStorage.getItem(cacheKey)).not.toBeNull();
    expect(loadCollectionsCache("https://other.example.com")).toBeNull();
  });

  it("expires after the 6 hour TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    saveCollectionsCache(ORIGIN, [], null);
    vi.setSystemTime(new Date(Date.now() + TTL_MS - 1));
    expect(loadCollectionsCache(ORIGIN)).not.toBeNull();
    vi.setSystemTime(new Date(Date.now() + 2));
    expect(loadCollectionsCache(ORIGIN)).toBeNull();
  });

  it.each([
    ["malformed JSON", "{oops"],
    ["a non-object", "5"],
    ["missing cachedAt", JSON.stringify({ ttlMs: 1, collections: [] })],
    ["missing ttlMs", JSON.stringify({ cachedAt: Date.now(), collections: [] })],
    ["collections not an array", JSON.stringify({ cachedAt: Date.now(), ttlMs: TTL_MS, collections: {} })],
  ])("treats %s as a cache miss", (_label, raw) => {
    localStorage.setItem(cacheKey, raw);
    expect(loadCollectionsCache(ORIGIN)).toBeNull();
  });

  it("never throws when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => saveCollectionsCache(ORIGIN, [], null)).not.toThrow();
    expect(loadCollectionsCache(ORIGIN)).toBeNull();
  });
});

describe("discoverCollections", () => {
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

    const result = await discoverCollections(ORIGIN);
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

    const result = await discoverCollections(ORIGIN);
    expect(result.collections[0]).toEqual({ handle: "all", title: "All Products", products_count: null });
    expect(result.collections.map((c) => c.handle)).toEqual(["all", "tees"]);
    expect(result.allProductsHandle).toBe("all");
  });

  it("skips probing when the listing already contains the all-products handle", async () => {
    const fetchMock = routedFetch({
      listing: () => jsonResponse(collectionsPage([["all", "All", 50], ["tees", "Tees", 5]])),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverCollections(ORIGIN);
    expect(probeUrls(fetchMock)).toEqual([]);
    expect(result.allProductsHandle).toBe("all");
  });

  it("tries known handles in order and stops at the first that has products", async () => {
    const fetchMock = routedFetch({
      listing: () => jsonResponse({ collections: [] }),
      probes: { "all-products": true, everything: true },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverCollections(ORIGIN);
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

    const result = await discoverCollections(ORIGIN);
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

    const result = await discoverCollections(ORIGIN);
    expect(result.collections.map((c) => c.handle)).toEqual(["shop-all"]);
    expect(result.allProductsHandle).toBe("shop-all");
  });

  it("throws the listing error when the listing fails and no probe finds anything", async () => {
    vi.stubGlobal(
      "fetch",
      routedFetch({ listing: () => jsonResponse({}, { ok: false, status: 500 }) })
    );

    await expect(discoverCollections(ORIGIN)).rejects.toThrow("Failed to fetch collections (status 500)");
  });

  it("returns an empty result (not an error) when the listing works but is empty", async () => {
    vi.stubGlobal("fetch", routedFetch({ listing: () => jsonResponse({ collections: [] }) }));
    await expect(discoverCollections(ORIGIN)).resolves.toEqual({
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

    const result = await discoverCollections(ORIGIN);
    expect(result.collections).toHaveLength(251);
    const listingCalls = fetchMock.mock.calls.filter(([u]) => u.includes("/collections.json"));
    expect(listingCalls).toHaveLength(2);
    expect(listingCalls[0][0]).toContain("limit=250&page=1");
  });

  it("stops if a page repeats the previous one (guards against ignored page params)", async () => {
    const full = Array.from({ length: 250 }, (_, i) => ({ handle: `c${i}`, title: `C${i}`, products_count: 1 }));
    const fetchMock = routedFetch({ listing: () => jsonResponse({ collections: full }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await discoverCollections(ORIGIN);
    expect(result.collections).toHaveLength(250);
    expect(fetchMock.mock.calls.filter(([u]) => u.includes("/collections.json"))).toHaveLength(2);
  });

  it("caches results and serves the cache until forceRefresh", async () => {
    const fetchMock = routedFetch({
      listing: () => jsonResponse(collectionsPage([["tees", "Tees", 5]])),
    });
    vi.stubGlobal("fetch", fetchMock);

    await discoverCollections(ORIGIN);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await discoverCollections(ORIGIN);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);

    await discoverCollections(ORIGIN, undefined, { forceRefresh: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("propagates an abort and does not cache a partial result", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw abort; }));

    await expect(discoverCollections(ORIGIN)).rejects.toBe(abort);
    expect(loadCollectionsCache(ORIGIN)).toBeNull();
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

    await expect(discoverCollections(ORIGIN)).rejects.toBe(abort);
    expect(loadCollectionsCache(ORIGIN)).toBeNull();
  });
});
