import { describe, it, expect } from "vitest";
import {
  createRegistry,
  defaultAdapter,
  detectAdapter,
  getAdapterById,
  resolveAdapter,
  supportedPlatformNames,
} from "./index";
import { shopifyAdapter } from "./shopify";

const fake = (id, name, matches) => ({ id, name, matchesUrl: (url) => matches(url) });
const url = (u) => new URL(u);

describe("default registry", () => {
  it("falls back to Shopify for any URL, as StoreLens did before adapters", () => {
    expect(defaultAdapter).toBe(shopifyAdapter);
    expect(detectAdapter(url("https://shop.example.com/collections/tees"))).toBe(shopifyAdapter);
    expect(detectAdapter(url("https://anything.example.org"))).toBe(shopifyAdapter);
  });

  it("finds a registered adapter by id and returns null for an unknown one", () => {
    expect(getAdapterById("shopify")).toBe(shopifyAdapter);
    expect(getAdapterById("nope")).toBeNull();
  });

  it("lists the registered platforms for user-facing copy", () => {
    expect(supportedPlatformNames()).toBe("Shopify");
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
    expect(registry.supportedPlatformNames()).toBe("Merch, Cart or Greedy");
    expect(createRegistry([merch, cart]).supportedPlatformNames()).toBe("Merch or Cart");
  });
});
