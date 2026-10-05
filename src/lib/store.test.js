import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  addressMatches,
  forgetVisitedCollection,
  loadVisitedCollections,
  saveVisitedCollection,
  titleFromHandle,
  appPathFor,
  clearPlatformCache,
  getDisplayOrigin,
  loadCollectionsCache,
  loadPlatformCache,
  savePlatformCache,
  parseUserInputToURL,
  saveCollectionsCache,
} from "./store";

import { memoryStorage } from "./__fixtures__/test-helpers";

const ORIGIN = "https://shop.example.com";
const TTL_MS = 21600000; // 6 hours, mirrors store.js

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
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

describe("getDisplayOrigin", () => {
  it("drops the scheme, keeps the port and lowercases the host", () => {
    expect(getDisplayOrigin("https://Shop.Example.com:8443")).toBe("shop.example.com:8443");
    expect(getDisplayOrigin("https://shop.example.com/")).toBe("shop.example.com");
  });

  it("keeps a locale prefix", () => {
    expect(getDisplayOrigin("https://shop.example.com/en-nz")).toBe("shop.example.com/en-nz");
  });
});

describe("collections cache", () => {
  const cacheKey = `storelens:collections:v3:shopify:${ORIGIN}`;

  it("round-trips collections and the all-products handle", () => {
    saveCollectionsCache("shopify", ORIGIN, [{ handle: "all", title: "All", products_count: 3 }], "all");
    expect(loadCollectionsCache("shopify", ORIGIN)).toEqual({
      collections: [{ handle: "all", title: "All", products_count: 3 }],
      allProductsHandle: "all",
    });
  });

  it("defaults allProductsHandle to null", () => {
    saveCollectionsCache("shopify", ORIGIN, [], undefined);
    expect(loadCollectionsCache("shopify", ORIGIN)).toEqual({ collections: [], allProductsHandle: null });
  });

  it("is keyed per platform, so another platform on the same origin is a miss", () => {
    saveCollectionsCache("shopify", ORIGIN, [{ handle: "a", title: "A", products_count: 1 }], null);
    expect(loadCollectionsCache("fourthwall", ORIGIN)).toBeNull();
  });

  it("is keyed per origin and cache version", () => {
    saveCollectionsCache("shopify", ORIGIN, [], null);
    expect(localStorage.getItem(cacheKey)).not.toBeNull();
    expect(loadCollectionsCache("shopify", "https://other.example.com")).toBeNull();
  });

  it("expires after the 6 hour TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    saveCollectionsCache("shopify", ORIGIN, [], null);
    vi.setSystemTime(new Date(Date.now() + TTL_MS - 1));
    expect(loadCollectionsCache("shopify", ORIGIN)).not.toBeNull();
    vi.setSystemTime(new Date(Date.now() + 2));
    expect(loadCollectionsCache("shopify", ORIGIN)).toBeNull();
  });

  it.each([
    ["malformed JSON", "{oops"],
    ["a non-object", "5"],
    ["missing cachedAt", JSON.stringify({ ttlMs: 1, collections: [] })],
    ["missing ttlMs", JSON.stringify({ cachedAt: Date.now(), collections: [] })],
    ["collections not an array", JSON.stringify({ cachedAt: Date.now(), ttlMs: TTL_MS, collections: {} })],
  ])("treats %s as a cache miss", (_label, raw) => {
    localStorage.setItem(cacheKey, raw);
    expect(loadCollectionsCache("shopify", ORIGIN)).toBeNull();
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
    expect(() => saveCollectionsCache("shopify", ORIGIN, [], null)).not.toThrow();
    expect(loadCollectionsCache("shopify", ORIGIN)).toBeNull();
  });
});

describe("appPathFor", () => {
  it("builds /{host}{path} for a collection URL", () => {
    expect(appPathFor(`${ORIGIN}/collections/tees`)).toBe("/shop.example.com/collections/tees");
  });

  it("is just the host for a bare origin", () => {
    expect(appPathFor(ORIGIN)).toBe("/shop.example.com");
    expect(appPathFor(`${ORIGIN}/`)).toBe("/shop.example.com");
  });

  it("keeps a locale prefix and a port", () => {
    expect(appPathFor(`${ORIGIN}/en-nz`)).toBe("/shop.example.com/en-nz");
    expect(appPathFor("http://localhost:8080/collections/all")).toBe("/localhost:8080/collections/all");
  });

  it("drops the query string and a trailing slash", () => {
    expect(appPathFor(`${ORIGIN}/collections/tees/?page=2`)).toBe("/shop.example.com/collections/tees");
  });
});

describe("addressMatches", () => {
  it("matches the same path", () => {
    expect(addressMatches("/shop.example.com/collections/tees", "/shop.example.com/collections/tees")).toBe(true);
  });

  it("ignores a trailing slash", () => {
    expect(addressMatches("/shop.example.com", "/shop.example.com/")).toBe(true);
  });

  it("ignores the case of the host segment only", () => {
    expect(addressMatches("/shop.example.com/collections/tees", "/Shop.Example.com/collections/tees")).toBe(true);
    expect(addressMatches("/shop.example.com/collections/tees", "/shop.example.com/collections/TEES")).toBe(false);
  });

  it("does not match a different store or collection", () => {
    expect(addressMatches("/other.example.com", "/shop.example.com")).toBe(false);
    expect(addressMatches("/shop.example.com/collections/a", "/shop.example.com/collections/b")).toBe(false);
    expect(addressMatches("/shop.example.com/en-nz", "/shop.example.com")).toBe(false);
  });
});

describe("the platform cache", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("remembers which platform an origin is on", () => {
    expect(loadPlatformCache(ORIGIN)).toBeNull();
    savePlatformCache(ORIGIN, "fourthwall");
    expect(loadPlatformCache(ORIGIN)).toBe("fourthwall");
  });

  it("keeps a separate answer per origin", () => {
    savePlatformCache(ORIGIN, "fourthwall");
    savePlatformCache("https://other.example.com", "shopify");
    expect(loadPlatformCache(ORIGIN)).toBe("fourthwall");
    expect(loadPlatformCache("https://other.example.com")).toBe("shopify");
    expect(loadPlatformCache("https://third.example.com")).toBeNull();
  });

  it("overwrites an earlier answer", () => {
    savePlatformCache(ORIGIN, "shopify");
    savePlatformCache(ORIGIN, "fourthwall");
    expect(loadPlatformCache(ORIGIN)).toBe("fourthwall");
  });

  it("forgets an answer after a week, and not before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    savePlatformCache(ORIGIN, "fourthwall");

    vi.setSystemTime(Date.now() + 7 * DAY_MS - 1000);
    expect(loadPlatformCache(ORIGIN)).toBe("fourthwall");
    vi.setSystemTime(Date.now() + 2000);
    expect(loadPlatformCache(ORIGIN)).toBeNull();
  });

  it("clears one origin's answer only", () => {
    savePlatformCache(ORIGIN, "fourthwall");
    savePlatformCache("https://other.example.com", "shopify");
    clearPlatformCache(ORIGIN);
    expect(loadPlatformCache(ORIGIN)).toBeNull();
    expect(loadPlatformCache("https://other.example.com")).toBe("shopify");
  });

  it("treats a damaged entry as no answer", () => {
    const key = `storelens:platform:v1:${ORIGIN}`;
    for (const bad of ["not json", "null", "{}", '{"cachedAt":1}', '{"platformId":5,"cachedAt":1}', '{"platformId":"x"}']) {
      localStorage.setItem(key, bad);
      expect(loadPlatformCache(ORIGIN)).toBeNull();
    }
  });

  it("does not collide with the collections cache", () => {
    saveCollectionsCache("shopify", ORIGIN, [{ handle: "a", title: "A", products_count: 1 }], "a");
    savePlatformCache(ORIGIN, "shopify");
    expect(loadCollectionsCache("shopify", ORIGIN).allProductsHandle).toBe("a");
    expect(loadPlatformCache(ORIGIN)).toBe("shopify");
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => savePlatformCache(ORIGIN, "shopify")).not.toThrow();
    expect(() => clearPlatformCache(ORIGIN)).not.toThrow();
    expect(loadPlatformCache(ORIGIN)).toBeNull();
  });
});

describe("titleFromHandle", () => {
  it("turns a handle into a title", () => {
    expect(titleFromHandle("mens-apparel")).toBe("Mens Apparel");
    expect(titleFromHandle("tees")).toBe("Tees");
    expect(titleFromHandle("new-in-2026")).toBe("New In 2026");
  });
});

describe("visited collections", () => {
  const KEY = "storelens:visited-collections:v1";
  const OTHER = "https://other.example.com";

  it("remembers collections per shop, most recent first", () => {
    expect(loadVisitedCollections(ORIGIN)).toEqual([]);
    saveVisitedCollection(ORIGIN, "tees");
    saveVisitedCollection(ORIGIN, "mugs");
    expect(loadVisitedCollections(ORIGIN)).toEqual(["mugs", "tees"]);
  });

  it("keeps each shop's collections apart", () => {
    saveVisitedCollection(ORIGIN, "tees");
    saveVisitedCollection(OTHER, "mugs");
    expect(loadVisitedCollections(ORIGIN)).toEqual(["tees"]);
    expect(loadVisitedCollections(OTHER)).toEqual(["mugs"]);
  });

  it("moves a collection opened again to the front, without duplicating it", () => {
    for (const handle of ["a", "b", "c", "a"]) saveVisitedCollection(ORIGIN, handle);
    expect(loadVisitedCollections(ORIGIN)).toEqual(["a", "c", "b"]);
  });

  it("keeps at most 20 collections a shop, dropping the oldest", () => {
    for (let i = 1; i <= 25; i++) saveVisitedCollection(ORIGIN, `c${i}`);
    const kept = loadVisitedCollections(ORIGIN);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe("c25");
    expect(kept.at(-1)).toBe("c6");
  });

  it("keeps at most 25 shops, dropping the least recently used", () => {
    for (let i = 1; i <= 30; i++) saveVisitedCollection(`https://shop${i}.example.com`, "tees");
    expect(loadVisitedCollections("https://shop1.example.com")).toEqual([]);
    expect(loadVisitedCollections("https://shop5.example.com")).toEqual([]);
    expect(loadVisitedCollections("https://shop6.example.com")).toEqual(["tees"]);
    expect(loadVisitedCollections("https://shop30.example.com")).toEqual(["tees"]);
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY)))).toHaveLength(25);
  });

  it("counts opening a shop's collection again as using that shop", () => {
    for (let i = 1; i <= 25; i++) saveVisitedCollection(`https://shop${i}.example.com`, "tees");
    saveVisitedCollection("https://shop1.example.com", "mugs");
    saveVisitedCollection("https://shop26.example.com", "tees");
    expect(loadVisitedCollections("https://shop1.example.com")).toEqual(["mugs", "tees"]);
    expect(loadVisitedCollections("https://shop2.example.com")).toEqual([]);
  });

  it("stores only short handles, and ignores anything that isn't one", () => {
    saveVisitedCollection(ORIGIN, "");
    saveVisitedCollection(ORIGIN, "with space");
    saveVisitedCollection(ORIGIN, "a/b");
    saveVisitedCollection(ORIGIN, "x".repeat(101));
    saveVisitedCollection(ORIGIN, 42);
    saveVisitedCollection(ORIGIN, null);
    expect(loadVisitedCollections(ORIGIN)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("stays small: a handful of collections is a few hundred bytes", () => {
    for (let i = 1; i <= 5; i++) saveVisitedCollection(ORIGIN, `collection-${i}`);
    expect(localStorage.getItem(KEY).length).toBeLessThan(200);
  });

  it("forgets one collection, and the shop once none is left", () => {
    saveVisitedCollection(ORIGIN, "tees");
    saveVisitedCollection(ORIGIN, "mugs");
    forgetVisitedCollection(ORIGIN, "tees");
    expect(loadVisitedCollections(ORIGIN)).toEqual(["mugs"]);
    forgetVisitedCollection(ORIGIN, "mugs");
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({});
  });

  it("forgetting something not remembered changes nothing", () => {
    saveVisitedCollection(ORIGIN, "tees");
    const before = localStorage.getItem(KEY);
    forgetVisitedCollection(ORIGIN, "mugs");
    forgetVisitedCollection(OTHER, "tees");
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it("treats damaged storage as empty, and repairs it on the next save", () => {
    for (const bad of ["not json", "null", "[]", '"x"', '{"https://x.example.com":"tees"}']) {
      localStorage.setItem(KEY, bad);
      expect(loadVisitedCollections("https://x.example.com")).toEqual([]);
    }
    localStorage.setItem(KEY, "not json");
    saveVisitedCollection(ORIGIN, "tees");
    expect(loadVisitedCollections(ORIGIN)).toEqual(["tees"]);
  });

  it("drops bad entries inside otherwise valid storage", () => {
    localStorage.setItem(KEY, JSON.stringify({ [ORIGIN]: ["tees", 5, "a b", null, "mugs"] }));
    expect(loadVisitedCollections(ORIGIN)).toEqual(["tees", "mugs"]);
  });

  it("survives storage being unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => saveVisitedCollection(ORIGIN, "tees")).not.toThrow();
    expect(() => forgetVisitedCollection(ORIGIN, "tees")).not.toThrow();
    expect(loadVisitedCollections(ORIGIN)).toEqual([]);
  });
});
