import { describe, it, expect } from "vitest";
import { detectAdapter, getAdapterById, shopifyAdapter, supportedPlatformNames } from "./index";

describe("detectAdapter", () => {
  it("falls back to Shopify for any URL, as StoreLens did before adapters", () => {
    expect(detectAdapter(new URL("https://shop.example.com/collections/tees"))).toBe(shopifyAdapter);
    expect(detectAdapter(new URL("https://anything.example.org"))).toBe(shopifyAdapter);
  });
});

describe("getAdapterById", () => {
  it("finds a registered adapter and returns null for an unknown id", () => {
    expect(getAdapterById("shopify")).toBe(shopifyAdapter);
    expect(getAdapterById("nope")).toBeNull();
  });
});

describe("supportedPlatformNames", () => {
  it("lists the registered platforms for user-facing copy", () => {
    expect(supportedPlatformNames()).toBe("Shopify");
  });
});
