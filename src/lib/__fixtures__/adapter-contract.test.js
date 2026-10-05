import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, expectAdapterShape, expectNeutralProduct } from "./adapter-contract";

// A minimal adapter and product that satisfy the contract; each test breaks one thing.
const adapter = (overrides = {}) => ({
  id: "fake",
  name: "Fake",
  labels: { vendors: "Vendor", categories: "Category" },
  capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])),
  matchesUrl: () => true,
  parseUrl: () => ({ origin: "https://shop.example.com", collection: null }),
  collectionUrl: (origin, collection) => `${origin}/c/${collection}`,
  listCollections: async () => ({ collections: [], allProductsHandle: null }),
  fetchCollection: async () => ({ products: [], pageError: null, truncated: false }),
  ...overrides,
});
const withCapability = (key, value, extra = {}) =>
  adapter({ capabilities: { ...adapter().capabilities, [key]: value }, ...extra });

const variant = (overrides = {}) => ({
  id: 1,
  title: "S",
  price: 10,
  compareAtPrice: null,
  available: true,
  options: ["S"],
  ...overrides,
});
const product = (overrides = {}) => ({
  id: "p1",
  handle: "tee",
  title: "Tee",
  url: "https://shop.example.com/products/tee",
  images: [{ url: "https://example.com/a.jpg" }],
  vendors: ["Acme"],
  categories: ["Shirts"],
  tags: ["summer"],
  available: true,
  variants: [variant()],
  options: [{ name: "Size", values: ["S"] }],
  ...overrides,
});
const caps = (overrides = {}) => ({ ...adapter().capabilities, ...overrides });

describe("expectAdapterShape", () => {
  it("accepts an adapter that follows the contract", () => {
    expect(() => expectAdapterShape(adapter())).not.toThrow();
  });

  it("accepts an adapter with no collection listing, if it names a default collection", () => {
    const noListing = withCapability("collectionDiscovery", false, { listCollections: undefined, defaultCollection: "all" });
    expect(() => expectAdapterShape(noListing)).not.toThrow();
  });

  it.each([
    ["a missing id", { id: undefined }],
    ["an empty id", { id: "" }],
    ["a non-string name", { name: 5 }],
    ["missing labels", { labels: undefined }],
    ["a non-string vendors label", { labels: { vendors: 1, categories: "Category" } }],
    ["a missing categories label", { labels: { vendors: "Vendor" } }],
    ["missing capabilities", { capabilities: undefined }],
    ["a missing method", { parseUrl: undefined }],
    ["a method that is not a function", { fetchCollection: {} }],
    ["no matchesUrl", { matchesUrl: undefined }],
  ])("rejects %s", (_, overrides) => {
    expect(() => expectAdapterShape(adapter(overrides))).toThrow();
  });

  it("rejects a capability that is missing, not a boolean, or unknown", () => {
    const { vendors: _vendors, ...missing } = adapter().capabilities;
    expect(() => expectAdapterShape(adapter({ capabilities: missing }))).toThrow(/capability keys/);
    expect(() => expectAdapterShape(withCapability("tags", "yes"))).toThrow(/not a boolean/);
    expect(() => expectAdapterShape(withCapability("description", true))).toThrow(/capability keys/);
  });

  it("rejects collection discovery without a listCollections", () => {
    expect(() => expectAdapterShape(adapter({ listCollections: undefined }))).toThrow(/needs listCollections/);
  });

  it("rejects no collection discovery without a default collection", () => {
    const noDefault = withCapability("collectionDiscovery", false, { listCollections: undefined });
    expect(() => expectAdapterShape(noDefault)).toThrow(/needs defaultCollection/);
    expect(() => expectAdapterShape({ ...noDefault, defaultCollection: "" })).toThrow(/empty/);
  });
});

describe("expectNeutralProduct", () => {
  const ok = (p, c = caps()) => expect(() => expectNeutralProduct(p, c)).not.toThrow();
  const bad = (p, pattern, c = caps()) => expect(() => expectNeutralProduct(p, c)).toThrow(pattern);

  it("accepts a well-formed product, with and without the optional fields", () => {
    ok(product());
    ok(product({ url: null }));
    ok(product({ description: "<p>hi</p>", currency: "NZD", createdAt: "2026-03-01T10:00:00Z" }));
    ok(product({ createdAt: "2026-03-01T10:00:00.000+13:00" }));
    ok(product({ variants: [variant({ compareAtPrice: 20.5 })] }));
  });

  it("rejects wrong field types", () => {
    bad(product({ id: null }), /id/);
    bad(product({ handle: 1 }), /handle/);
    bad(product({ title: undefined }), /title/);
    bad(product({ images: [{ src: "x" }] }), /images/);
    bad(product({ images: null }), /images/);
    bad(product({ description: 5 }), /description/);
    bad(product({ vendors: "Acme" }), /vendors/);
    bad(product({ tags: [1] }), /tags/);
    bad(product({ available: "yes" }), /available/);
    bad(product({ options: [{ name: "Size", values: "S" }] }), /values/);
  });

  it("rejects a url that isn't absolute http(s)", () => {
    bad(product({ url: "/products/tee" }), /not absolute/);
    bad(product({ url: "ftp://shop.example.com/x" }), /not http/);
    bad(product({ url: 5 }), /url/);
  });

  it("rejects a createdAt that isn't ISO 8601, such as a plain 'YYYY-MM-DD HH:MM:SS UTC'", () => {
    bad(product({ createdAt: "2026-09-28 18:59:56 UTC" }), /ISO 8601/);
    bad(product({ createdAt: "yesterday" }), /ISO 8601/);
    bad(product({ createdAt: "2026-13-45T10:00:00Z" }), /parse/);
  });

  it("rejects a currency that isn't a 3-letter code", () => {
    bad(product({ currency: "usd" }), /currency/);
    bad(product({ currency: "$" }), /currency/);
    bad(product({ currency: "USDX" }), /currency/);
  });

  it("rejects bad variant prices and fields", () => {
    bad(product({ variants: [variant({ price: "10.00" })] }), /finite number/);
    bad(product({ variants: [variant({ price: NaN })] }), /finite number/);
    bad(product({ variants: [variant({ compareAtPrice: undefined })] }), /compareAtPrice/);
    bad(product({ variants: [variant({ compareAtPrice: "20" })] }), /compareAtPrice/);
    bad(product({ variants: [variant({ available: 1 })] }), /variant available/);
    bad(product({ variants: [variant({ options: "S" })] }), /variant options/);
    bad(product({ variants: [variant({ id: {} })] }), /variant id/);
  });

  it("rejects a variant with more option values than the product has options", () => {
    bad(product({ variants: [variant({ options: ["S", "Blue"] })] }), /more option values/);
  });

  it("rejects a product whose availability disagrees with its variants", () => {
    bad(product({ available: true, variants: [variant({ available: false })] }), /any variant available/);
    bad(product({ available: false, variants: [variant({ available: true })] }), /any variant available/);
    ok(product({ available: false, variants: [variant({ available: false })] }));
  });

  describe("capability consistency", () => {
    it("requires every product to be available when stock isn't reported", () => {
      const noStock = caps({ variantStock: false });
      ok(product(), noStock);
      bad(product({ available: false, variants: [variant({ available: false })] }), /variantStock is false/, noStock);
      bad(product({ variants: [variant(), variant({ available: false })] }), /every variant is available/, noStock);
    });

    it("requires empty vendors, categories and tags when the platform has none", () => {
      bad(product(), /vendors capability/, caps({ vendors: false }));
      bad(product(), /categories capability/, caps({ categories: false }));
      bad(product(), /tags capability/, caps({ tags: false }));
      ok(product({ vendors: [], categories: [], tags: [] }), caps({ vendors: false, categories: false, tags: false }));
    });

    it("requires no options when variant options aren't supported", () => {
      bad(product(), /variantOptions capability/, caps({ variantOptions: false }));
      ok(product({ options: [], variants: [variant({ options: [] })] }), caps({ variantOptions: false }));
    });

    it("doesn't apply a check for a capability that is true", () => {
      ok(product({ vendors: [], categories: [], tags: [] }));
    });
  });
});
