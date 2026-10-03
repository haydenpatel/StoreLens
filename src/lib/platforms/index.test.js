import { describe, it, expect } from "vitest";
import {
  createRegistry,
  defaultAdapter,
  detectAdapter,
  getAdapterById,
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
