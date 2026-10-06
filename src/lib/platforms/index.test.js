import { describe, it, expect, vi } from "vitest";
import {
  createRegistry,
  defaultAdapter,
  detectAdapter,
  getAdapterById,
  resolveAdapter,
  supportNotes,
  supportedPlatformNames,
} from "./index";
import { shopifyAdapter } from "./shopify";
import { fourthwallAdapter } from "./fourthwall";
import { bigcartelAdapter } from "./bigcartel";

const fake = (id, name, matches) => ({ id, name, matchesUrl: (url) => matches(url) });
const url = (u) => new URL(u);

describe("default registry", () => {
  it("falls back to Shopify for any URL, as StoreLens did before adapters", () => {
    expect(defaultAdapter).toBe(shopifyAdapter);
    expect(detectAdapter(url("https://shop.example.com/collections/tees"))).toBe(shopifyAdapter);
    expect(detectAdapter(url("https://anything.example.org"))).toBe(shopifyAdapter);
  });

  it("claims only a Fourthwall page URL on its own; other URLs wait for a network check", () => {
    expect(detectAdapter(url("https://shop.example.com/collections/all/2.json"))).toBe(fourthwallAdapter);
    expect(detectAdapter(url("https://shop.example.com/collections/all"))).toBe(shopifyAdapter);
    expect(detectAdapter(url("https://shop.example.com"))).toBe(shopifyAdapter);
  });

  it("claims a *.bigcartel.com address on its own, without a network check", async () => {
    expect(detectAdapter(url("https://shop-name.bigcartel.com"))).toBe(bigcartelAdapter);
    expect(detectAdapter(url("https://shop-name.bigcartel.com/category/tees"))).toBe(bigcartelAdapter);
    expect(detectAdapter(url("https://www.bigcartel.com"))).toBe(shopifyAdapter);
    expect(detectAdapter(url("https://shop.example.com"))).toBe(shopifyAdapter);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveAdapter(url("https://shop-name.bigcartel.com"))).toBe(bigcartelAdapter);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("finds a registered adapter by id and returns null for an unknown one", () => {
    expect(getAdapterById("fourthwall")).toBe(fourthwallAdapter);
    expect(getAdapterById("shopify")).toBe(shopifyAdapter);
    expect(getAdapterById("bigcartel")).toBe(bigcartelAdapter);
    expect(getAdapterById("nope")).toBeNull();
  });

  it("collects the adapters' support notes for error copy", () => {
    expect(supportNotes()).toEqual([bigcartelAdapter.supportNote]);
    expect(createRegistry([{ ...fake("a", "A", () => false), supportNote: "Note A." }, fake("b", "B", () => true)]).supportNotes()).toEqual(["Note A."]);
  });

  it("lists the registered platforms for user-facing copy", () => {
    expect(supportedPlatformNames()).toBe("Shopify, Fourthwall or Big Cartel");
  });
});

describe("resolveAdapter", () => {
  it("settles on the same adapter detectAdapter finds, asynchronously", async () => {
    const target = url("https://shop.example.com/collections/tees");
    const pending = resolveAdapter(target);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toBe(detectAdapter(target));
    expect(await pending).toBe(shopifyAdapter);
  });

  it("uses the registry's own order and fallback", async () => {
    const merch = fake("merch", "Merch", (u) => u.hostname.endsWith(".merch.test"));
    const cart = fake("cart", "Cart", () => true);
    const registry = createRegistry([merch, cart]);
    expect(await registry.resolveAdapter(url("https://a.merch.test"))).toBe(merch);
    expect(await registry.resolveAdapter(url("https://elsewhere.test"))).toBe(cart);
  });

  it("works without options", async () => {
    expect(await resolveAdapter(url("https://shop.example.com"), undefined)).toBe(shopifyAdapter);
    expect(await resolveAdapter(url("https://shop.example.com"), {})).toBe(shopifyAdapter);
  });

  it("rejects with an AbortError if the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolveAdapter(url("https://shop.example.com"), { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("resolveAdapter's network detection and platform cache", () => {
  const memoryCache = (initial = {}) => {
    const store = new Map(Object.entries(initial));
    return {
      store,
      load: (origin) => store.get(origin) ?? null,
      save: (origin, id) => store.set(origin, id),
      clear: (origin) => store.delete(origin),
    };
  };
  // An adapter whose detect() answers from `answers`, counting its calls.
  const detecting = (id, answer) => {
    const adapter = { ...fake(id, id, () => false), detect: vi.fn(async () => answer) };
    return adapter;
  };
  const shop = url("https://shop.example.com/collections/all");

  it("asks adapters that can detect, in order, and uses the first that claims the store", async () => {
    const a = detecting("a", false);
    const b = detecting("b", true);
    const c = detecting("c", true);
    const fallback = fake("fb", "Fallback", () => true);
    const registry = createRegistry([a, b, c, fallback], { cache: memoryCache() });
    expect(await registry.resolveAdapter(shop)).toBe(b);
    expect(a.detect).toHaveBeenCalledTimes(1);
    expect(b.detect).toHaveBeenCalledTimes(1);
    expect(c.detect).not.toHaveBeenCalled();
  });

  it("passes the URL and the signal to detect", async () => {
    const a = detecting("a", false);
    const controller = new AbortController();
    await createRegistry([a, fake("fb", "Fallback", () => true)], { cache: memoryCache() }).resolveAdapter(shop, {
      signal: controller.signal,
    });
    expect(a.detect).toHaveBeenCalledWith(shop, { signal: controller.signal });
  });

  it("falls back when nothing claims the store, without remembering the fallback", async () => {
    const cache = memoryCache();
    const fb = fake("fb", "Fallback", () => true);
    expect(await createRegistry([detecting("a", false), fb], { cache }).resolveAdapter(shop)).toBe(fb);
    expect(cache.store.size).toBe(0);
  });

  it("remembers a positive detection per origin, and uses it without asking again", async () => {
    const cache = memoryCache();
    const a = detecting("a", true);
    const registry = createRegistry([a, fake("fb", "Fallback", () => true)], { cache });

    expect(await registry.resolveAdapter(url("https://shop.example.com/en-nz/collections/all"))).toBe(a);
    expect(cache.store.get("https://shop.example.com")).toBe("a");

    expect(await registry.resolveAdapter(url("https://shop.example.com/collections/other"))).toBe(a);
    expect(a.detect).toHaveBeenCalledTimes(1);
  });

  it("uses the remembered platform before any network check, including the fallback", async () => {
    const a = detecting("a", true);
    const fb = fake("fb", "Fallback", () => true);
    const registry = createRegistry([a, fb], { cache: memoryCache({ "https://shop.example.com": "fb" }) });
    expect(await registry.resolveAdapter(shop)).toBe(fb);
    expect(a.detect).not.toHaveBeenCalled();
  });

  it("ignores a remembered platform it no longer has", async () => {
    const a = detecting("a", true);
    const registry = createRegistry([a, fake("fb", "Fallback", () => true)], {
      cache: memoryCache({ "https://shop.example.com": "gone" }),
    });
    expect(await registry.resolveAdapter(shop)).toBe(a);
  });

  it("does not detect or consult the cache when an adapter recognises the URL itself", async () => {
    const a = { ...detecting("a", false), matchesUrl: () => true };
    const fb = fake("fb", "Fallback", () => true);
    const cache = memoryCache({ "https://shop.example.com": "fb" });
    expect(await createRegistry([a, fb], { cache }).resolveAdapter(shop)).toBe(a);
    expect(a.detect).not.toHaveBeenCalled();
  });

  it("rememberAdapter and forgetAdapter write and clear the origin's entry", () => {
    const cache = memoryCache();
    const fb = fake("fb", "Fallback", () => true);
    const registry = createRegistry([fb], { cache });
    registry.rememberAdapter(shop, fb);
    expect(cache.store.get("https://shop.example.com")).toBe("fb");
    registry.forgetAdapter(url("https://shop.example.com/anything"));
    expect(cache.store.size).toBe(0);
  });

  it("propagates an abort from detect", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const a = { ...fake("a", "a", () => false), detect: vi.fn(async () => Promise.reject(abort)) };
    const registry = createRegistry([a, fake("fb", "Fallback", () => true)], { cache: memoryCache() });
    await expect(registry.resolveAdapter(shop)).rejects.toBe(abort);
  });
});

describe("createRegistry", () => {
  const merch = fake("merch", "Merch", (u) => u.hostname.endsWith(".merch.test"));
  const cart = fake("cart", "Cart", (u) => u.hostname.endsWith(".cart.test"));
  const greedy = fake("greedy", "Greedy", () => true);
  const registry = createRegistry([merch, cart, greedy]);

  it("uses the first adapter that matches, in list order", () => {
    expect(registry.detectAdapter(url("https://a.merch.test"))).toBe(merch);
    expect(registry.detectAdapter(url("https://a.cart.test"))).toBe(cart);
  });

  it("lets an earlier adapter win over a later one that also matches", () => {
    const both = fake("both", "Both", () => true);
    expect(createRegistry([both, greedy]).detectAdapter(url("https://x.test"))).toBe(both);
  });

  it("falls back to the last adapter when none match", () => {
    const strict = fake("strict", "Strict", () => false);
    const last = fake("last", "Last", () => false);
    const r = createRegistry([strict, last]);
    expect(r.detectAdapter(url("https://x.test"))).toBe(last);
    expect(r.defaultAdapter).toBe(last);
  });

  it("joins several platform names for copy", () => {
    // The fallback (the last adapter, the original platform) is named first.
    expect(registry.supportedPlatformNames()).toBe("Greedy, Merch or Cart");
    expect(createRegistry([merch, cart]).supportedPlatformNames()).toBe("Cart or Merch");
    expect(createRegistry([cart]).supportedPlatformNames()).toBe("Cart");
  });
});
