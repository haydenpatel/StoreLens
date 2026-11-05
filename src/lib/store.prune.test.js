import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryStorage } from "./__fixtures__/test-helpers";

const COLLECTIONS_TTL_MS = 21600000; // mirrors store.js
const PLATFORM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ORIGIN = "https://shop.example.com";
const HOUR = 3600000;

const entry = (cachedAt) => JSON.stringify({ cachedAt, collections: [] });
const platformEntry = (cachedAt) => JSON.stringify({ cachedAt, platformId: "shopify" });
const keys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort();

// store.js prunes once per page session, so each test loads a fresh copy.
let store;
beforeEach(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.resetModules();
  store = await import("./store");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pruning caches on save", () => {
  it("removes older-version collections and platform keys", () => {
    localStorage.setItem("storelens:collections:v2:https://a.example.com", entry(Date.now()));
    localStorage.setItem("storelens:collections:v1:shopify:https://a.example.com", entry(Date.now()));
    localStorage.setItem("storelens:platform:v0:https://a.example.com", platformEntry(Date.now()));
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    store.savePlatformCache(ORIGIN, "shopify");
    expect(keys()).toEqual([`storelens:collections:v3:shopify:${ORIGIN}`, `storelens:platform:v1:${ORIGIN}`]);
  });

  it("removes expired current-version entries but keeps live ones", () => {
    const now = Date.now();
    localStorage.setItem("storelens:collections:v3:shopify:https://old.example.com", entry(now - COLLECTIONS_TTL_MS - 1));
    localStorage.setItem("storelens:collections:v3:shopify:https://live.example.com", entry(now - HOUR));
    localStorage.setItem("storelens:collections:v3:shopify:https://corrupt.example.com", "{oops");
    localStorage.setItem("storelens:platform:v1:https://old.example.com", platformEntry(now - PLATFORM_TTL_MS - 1));
    localStorage.setItem("storelens:platform:v1:https://live.example.com", platformEntry(now - HOUR));
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    store.savePlatformCache(ORIGIN, "shopify");
    expect(keys()).toEqual([
      "storelens:collections:v3:shopify:https://live.example.com",
      `storelens:collections:v3:shopify:${ORIGIN}`,
      "storelens:platform:v1:https://live.example.com",
      `storelens:platform:v1:${ORIGIN}`,
    ]);
  });

  it("never touches the theme, Recent Stores, visited-collections or other keys", () => {
    const others = {
      "storelens-theme": "dark",
      "storelens-url-history": '["a.example.com"]',
      "storelens:visited-collections:v1": "{}",
      "storelens:collections": "bare",
      "storelens:collections:vnext:x": "not a version",
      "storelens:platformish:v0:x": "other family",
      "storelens:something-else:v1:x": "unknown",
      unrelated: "1",
    };
    for (const [k, v] of Object.entries(others)) localStorage.setItem(k, v);
    localStorage.setItem("storelens:collections:v2:x", entry(0));
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    store.savePlatformCache(ORIGIN, "shopify");
    for (const [k, v] of Object.entries(others)) expect(localStorage.getItem(k)).toBe(v);
    expect(localStorage.getItem("storelens:collections:v2:x")).toBeNull();
  });

  it("leaves newer-version keys alone", () => {
    localStorage.setItem("storelens:collections:v99:shopify:https://a.example.com", entry(0));
    localStorage.setItem("storelens:platform:v99:https://a.example.com", platformEntry(0));
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    store.savePlatformCache(ORIGIN, "shopify");
    expect(localStorage.getItem("storelens:collections:v99:shopify:https://a.example.com")).not.toBeNull();
    expect(localStorage.getItem("storelens:platform:v99:https://a.example.com")).not.toBeNull();
  });

  it("keeps the entry it just wrote", () => {
    store.saveCollectionsCache("shopify", ORIGIN, [{ handle: "a", title: "A", products_count: 1 }], "a");
    expect(store.loadCollectionsCache("shopify", ORIGIN)?.allProductsHandle).toBe("a");
  });

  it("prunes each family once per session, not on every save", () => {
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    localStorage.setItem("storelens:collections:v2:late", entry(Date.now()));
    const scan = vi.spyOn(localStorage, "key");
    store.saveCollectionsCache("shopify", "https://b.example.com", [], null);
    expect(scan).not.toHaveBeenCalled();
    expect(localStorage.getItem("storelens:collections:v2:late")).not.toBeNull();
  });

  it("does not scan storage on a load", () => {
    const scan = vi.spyOn(localStorage, "key");
    store.loadCollectionsCache("shopify", ORIGIN);
    store.loadPlatformCache(ORIGIN);
    expect(scan).not.toHaveBeenCalled();
  });
});

describe("a save that hits a full quota", () => {
  // A storage that holds `capacity` entries and throws when a new key won't fit.
  function limitedStorage(capacity) {
    const inner = memoryStorage();
    return {
      ...inner,
      get length() {
        return inner.length;
      },
      setItem: vi.fn((k, v) => {
        if (inner.getItem(k) === null && inner.length >= capacity) throw new DOMException("full", "QuotaExceededError");
        inner.setItem(k, v);
      }),
    };
  }

  it("frees expired and older-version entries, then retries once", () => {
    const storage = limitedStorage(3);
    vi.stubGlobal("localStorage", storage);
    storage.setItem("storelens-theme", "dark");
    storage.setItem("storelens:collections:v2:old", entry(Date.now()));
    storage.setItem("storelens:platform:v1:https://old.example.com", platformEntry(0));
    storage.setItem.mockClear();
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(keys()).toEqual(["storelens-theme", `storelens:collections:v3:shopify:${ORIGIN}`]);
  });

  it("keeps newer-version keys when freeing space", () => {
    const storage = limitedStorage(2);
    vi.stubGlobal("localStorage", storage);
    storage.setItem("storelens:collections:v99:x", entry(0));
    storage.setItem("storelens:platform:v99:x", platformEntry(0));
    store.saveCollectionsCache("shopify", ORIGIN, [], null);
    expect(keys()).toEqual(["storelens:collections:v99:x", "storelens:platform:v99:x"]);
  });

  it("gives up quietly when nothing can be freed, leaving live and unrelated keys", () => {
    const storage = limitedStorage(2);
    vi.stubGlobal("localStorage", storage);
    storage.setItem("storelens-theme", "dark");
    storage.setItem("storelens:platform:v1:https://live.example.com", platformEntry(Date.now()));
    storage.setItem.mockClear();
    expect(() => store.saveCollectionsCache("shopify", ORIGIN, [], null)).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(keys()).toEqual(["storelens-theme", "storelens:platform:v1:https://live.example.com"]);
  });
});

describe("pruning when storage is unavailable", () => {
  it("never throws if storage throws on every access", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      key: boom,
      get length() {
        return boom();
      },
    });
    expect(() => store.saveCollectionsCache("shopify", ORIGIN, [], null)).not.toThrow();
    expect(() => store.savePlatformCache(ORIGIN, "shopify")).not.toThrow();
  });

  it("never throws if the write works but listing keys fails", () => {
    const inner = memoryStorage();
    vi.stubGlobal("localStorage", {
      ...inner,
      key: () => {
        throw new Error("blocked");
      },
      get length() {
        return 1;
      },
    });
    expect(() => store.saveCollectionsCache("shopify", ORIGIN, [], null)).not.toThrow();
    expect(inner.getItem(`storelens:collections:v3:shopify:${ORIGIN}`)).not.toBeNull();
  });

  it("never throws if localStorage is absent", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => store.saveCollectionsCache("shopify", ORIGIN, [], null)).not.toThrow();
    expect(() => store.savePlatformCache(ORIGIN, "shopify")).not.toThrow();
  });
});
