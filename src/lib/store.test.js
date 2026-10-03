import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDisplayHost,
  getOrigin,
  loadCollectionsCache,
  parseUserInputToURL,
  saveCollectionsCache,
} from "./store";

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

describe("getOrigin / getDisplayHost", () => {
  const url = new URL("https://Shop.Example.com:8443/collections/tees?x=1");

  it("returns the origin and host (host keeps the port, lowercased)", () => {
    expect(getOrigin(url)).toBe("https://shop.example.com:8443");
    expect(getDisplayHost(url)).toBe("shop.example.com:8443");
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
