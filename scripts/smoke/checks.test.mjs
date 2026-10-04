import { describe, expect, it } from "vitest";
import {
  checkCors,
  validateBigCartelProducts,
  validateFourthwallPage,
  validateShopifyCollections,
  validateShopifyPage,
  worstStatus,
} from "./checks.mjs";

// Invented products; shapes mirror the feeds the adapters read.
const shopifyVariant = { id: 1, title: "S", price: "10.00", compare_at_price: null, available: true, option1: "S", option2: null, option3: null };
const shopifyProduct = {
  id: 1, title: "Example Tee", handle: "example-tee", body_html: "", vendor: "Example", product_type: "Tee",
  tags: [], created_at: "2026-01-01T00:00:00Z", variants: [shopifyVariant], images: [], options: [],
};
const fourthwallProduct = {
  id: "a", title: "Example Tee", handle: "example-tee", url: "/products/example-tee", image: "https://example.com/a.webp",
  price: "20.00", compare_at_price: null, available: true, created_at: "2026-01-01 00:00:00 UTC",
  variants: [{ id: "v", title: "S", price: { cents: 2000, currency_iso: "USD" } }],
};
const bigCartelProduct = {
  id: 1, name: "Example Tee", permalink: "example-tee", url: "/product/example-tee", price: 30, default_price: 30,
  on_sale: false, status: "active", created_at: "2026-01-01T00:00:00.000+00:00", description: "", images: [],
  options: [{ id: 2, name: "S", price: 30, sold_out: false }],
};

describe("checkCors", () => {
  it("accepts * and the StoreLens origin", () => {
    expect(checkCors(new Headers({ "access-control-allow-origin": "*" }))).toEqual([]);
    expect(checkCors(new Headers({ "access-control-allow-origin": "https://storelens.pages.dev" }))).toEqual([]);
  });
  it("rejects a missing or different origin", () => {
    expect(checkCors(new Headers())).toEqual(["no Access-Control-Allow-Origin header"]);
    expect(checkCors(new Headers({ "access-control-allow-origin": "https://other.example" }))).toHaveLength(1);
  });
});

describe("validateShopifyPage", () => {
  it("accepts a well-formed page", () => {
    expect(validateShopifyPage({ products: [shopifyProduct] })).toEqual([]);
    expect(validateShopifyPage({ products: [] })).toEqual([]);
  });
  it("flags a missing products array", () => {
    expect(validateShopifyPage({})).toEqual(["response has no products array"]);
    expect(validateShopifyPage(null)).toEqual(["response has no products array"]);
  });
  it("flags missing product and variant keys, once per distinct problem", () => {
    const { vendor: _vendor, ...noVendor } = shopifyProduct;
    const badVariant = { ...shopifyProduct, variants: [{ ...shopifyVariant, compare_at_price: undefined, price: "x" }] };
    delete badVariant.variants[0].compare_at_price;
    const problems = validateShopifyPage({ products: [noVendor, badVariant] });
    expect(problems).toContain("product.vendor missing (1/2)");
    expect(problems).toContain("variant.compare_at_price missing (1/2)");
    expect(problems).toContain("variant.price is not numeric (1/2)");
  });
  it("flags a product with no variants", () => {
    expect(validateShopifyPage({ products: [{ ...shopifyProduct, variants: [] }] })).toEqual(["product.variants is empty"]);
  });
});

describe("validateShopifyCollections", () => {
  it("checks the keys discovery relies on", () => {
    expect(validateShopifyCollections({ collections: [{ handle: "a", title: "A", products_count: 1 }] })).toEqual([]);
    expect(validateShopifyCollections({ collections: [{ handle: "a", title: "A" }] })).toEqual(["collection.products_count missing"]);
    expect(validateShopifyCollections({})).toEqual(["response has no collections array"]);
  });
});

describe("validateFourthwallPage", () => {
  it("accepts a well-formed page, with or without a compare-at price", () => {
    expect(validateFourthwallPage({ current_page: 1, products: [fourthwallProduct] }, 1)).toEqual([]);
    expect(validateFourthwallPage({ current_page: 2, products: [{ ...fourthwallProduct, compare_at_price: "29.00" }] }, 2)).toEqual([]);
  });
  it("accepts the empty terminating page", () => {
    expect(validateFourthwallPage({ current_page: 9, products: [] }, 9)).toEqual([]);
  });
  it("flags a page counter that does not match", () => {
    expect(validateFourthwallPage({ current_page: 1, products: [] }, 2)).toEqual(["current_page is 1, expected 2"]);
  });
  it("flags missing keys and bad variant prices", () => {
    const { image: _image, ...noImage } = fourthwallProduct;
    const flatPrice = { ...fourthwallProduct, variants: [{ id: "v", title: "S", price: "20.00" }] };
    const problems = validateFourthwallPage({ current_page: 1, products: [noImage, flatPrice] }, 1);
    expect(problems).toContain("product.image missing (1/2)");
    expect(problems).toContain("variant.price is not an object (1/2)");
  });
});

describe("validateBigCartelProducts", () => {
  it("accepts a well-formed array", () => {
    expect(validateBigCartelProducts([bigCartelProduct])).toEqual([]);
    expect(validateBigCartelProducts([])).toEqual([]);
  });
  it("flags a non-array body", () => {
    expect(validateBigCartelProducts({ products: [] })).toEqual(["response is not an array"]);
  });
  it("flags missing keys and bad option stock", () => {
    const { permalink: _permalink, ...noPermalink } = bigCartelProduct;
    const badOption = { ...bigCartelProduct, options: [{ id: 2, name: "S", price: 30, sold_out: "no" }] };
    const problems = validateBigCartelProducts([noPermalink, badOption]);
    expect(problems).toContain("product.permalink missing (1/2)");
    expect(problems).toContain("option.sold_out is not a boolean (1/2)");
  });
});

describe("worstStatus", () => {
  it("ranks fail above gone above warn above pass", () => {
    expect(worstStatus(["pass", "warn", "gone", "fail"])).toBe("fail");
    expect(worstStatus(["pass", "gone", "warn"])).toBe("gone");
    expect(worstStatus(["pass", "warn"])).toBe("warn");
    expect(worstStatus(["pass"])).toBe("pass");
  });
});
