import { describe, it, expect } from "vitest";
import {
  buildFilterSearch,
  computeFilterData,
  countActiveFilters,
  filterAndSortProducts,
  parseFilterParams,
} from "./filters";
import { normalizeShopifyProduct } from "./platforms/shopify";
import {
  catalog as rawCatalog,
  product,
  scatteredOptionsCatalog as rawScatteredOptionsCatalog,
  variant,
} from "./__fixtures__/shopify";

// These tests were written against raw Shopify products before the platform
// adapter refactor. They now feed the same fixtures through the Shopify
// normalizer with unchanged expectations, which is what shows the refactor
// kept behaviour identical.
const norm = (raws) => raws.map((p) => normalizeShopifyProduct(p, "https://shop.example.com"));
const catalog = () => norm(rawCatalog());
const scatteredOptionsCatalog = () => norm(rawScatteredOptionsCatalog());

const defaults = {
  searchQuery: "",
  selectedVendors: [],
  selectedTypes: [],
  selectedTags: [],
  selectedOptions: {},
  priceRange: [0, 10000],
  inStockOnly: false,
  saleOnly: false,
  sortBy: "title-asc",
};

const titles = (products) => products.map((p) => p.title);
const run = (state = {}, products = catalog()) =>
  titles(filterAndSortProducts(products, { ...defaults, ...state }));

describe("computeFilterData", () => {
  it("collects sorted vendors, types, tags and price bounds", () => {
    const data = computeFilterData(catalog());
    expect(data.vendors).toEqual(["Acme", "Beta Co"]);
    expect(data.types).toEqual(["Hoodies", "Mugs", "Shirts"]);
    expect(data.tags).toEqual(["cotton", "gift", "summer", "winter"]);
    expect(data.minPrice).toBe(5);
    expect(data.maxPrice).toBe(50);
  });

  it("builds option groups keyed option1..3 with names from the first product", () => {
    const { options } = computeFilterData(catalog());
    expect(options).toEqual([
      { name: "Size", key: "option1", values: ["L", "M", "S"] },
      { name: "Color", key: "option2", values: ["Blue"] },
    ]);
  });

  it("floors the minimum and ceils the maximum price", () => {
    const data = computeFilterData(
      norm([product({ variants: [variant({ price: "9.99" }), variant({ price: "20.01" })] })])
    );
    expect(data.minPrice).toBe(9);
    expect(data.maxPrice).toBe(21);
  });

  it("falls back to 0 and 1000 when there are no priced variants", () => {
    const data = computeFilterData([]);
    expect(data.minPrice).toBe(0);
    expect(data.maxPrice).toBe(1000);
    expect(data.options).toEqual([]);
  });

  // KNOWN ISSUE, pinned so the refactor in #22 cannot change it by accident.
  // #27 replaces this with name-keyed option filters. Today every product's
  // optionN is merged into one group named after the *first* product, so
  // sizes, colors and "Default Title" end up mixed together.
  it("mixes different option names that share a position (known issue, see #27)", () => {
    const { options } = computeFilterData(scatteredOptionsCatalog());
    expect(options).toEqual([
      {
        name: "Color",
        key: "option1",
        values: ["Black", "Default Title", "Large", "Olive", "Small"],
      },
      { name: "Length", key: "option2", values: ["Black", "Regular", "Short"] },
      { name: "option3", key: "option3", values: ["Large"] },
    ]);
  });
});

describe("filterAndSortProducts", () => {
  it("returns everything sorted by title with default state", () => {
    expect(run()).toEqual(["Acme Blue Tee", "Beta Red Hoodie", "Cedar Mug", "Delta Cap"]);
  });

  it("does not mutate the input array", () => {
    const input = catalog();
    const before = titles(input);
    filterAndSortProducts(input, { ...defaults, sortBy: "price-desc" });
    expect(titles(input)).toEqual(before);
  });

  describe("search", () => {
    it("matches title and body_html, case-insensitively", () => {
      expect(run({ searchQuery: "HOODIE" })).toEqual(["Beta Red Hoodie"]);
      expect(run({ searchQuery: "soft cotton" })).toEqual(["Acme Blue Tee"]);
    });

    it("does not search tags or vendor", () => {
      expect(run({ searchQuery: "gift" })).toEqual([]);
      expect(run({ searchQuery: "beta co" })).toEqual([]);
    });
  });

  describe("vendor, type and tag filters", () => {
    it("filters by vendor", () => {
      expect(run({ selectedVendors: ["Acme"] })).toEqual(["Acme Blue Tee", "Cedar Mug"]);
    });

    it("filters by product type", () => {
      expect(run({ selectedTypes: ["Mugs"] })).toEqual(["Cedar Mug"]);
    });

    it("matches products having any selected tag", () => {
      expect(run({ selectedTags: ["winter", "gift"] })).toEqual(["Beta Red Hoodie", "Cedar Mug"]);
      expect(run({ selectedTags: ["cotton"] })).toEqual(["Acme Blue Tee", "Cedar Mug"]);
    });

    it("excludes products with no vendor when a vendor is selected", () => {
      expect(run({ selectedVendors: ["Acme", "Beta Co"] })).not.toContain("Delta Cap");
    });
  });

  describe("option filters (keyed optionN)", () => {
    it("matches products with any variant having the option value", () => {
      expect(run({ selectedOptions: { option1: ["M"] } })).toEqual(["Acme Blue Tee"]);
      expect(run({ selectedOptions: { option1: ["S", "L"] } })).toEqual([
        "Acme Blue Tee",
        "Beta Red Hoodie",
      ]);
    });

    it("ANDs different option keys", () => {
      expect(run({ selectedOptions: { option1: ["L"], option2: ["Blue"] } })).toEqual([]);
      expect(run({ selectedOptions: { option1: ["M"], option2: ["Blue"] } })).toEqual([
        "Acme Blue Tee",
      ]);
    });

    it("ignores an option key with no selected values", () => {
      expect(run({ selectedOptions: { option1: [] } })).toHaveLength(4);
    });
  });

  describe("price range", () => {
    it("includes products whose variant price range overlaps the filter range", () => {
      expect(run({ priceRange: [0, 10] })).toEqual(["Delta Cap"]);
      expect(run({ priceRange: [45, 60] })).toEqual(["Beta Red Hoodie"]);
      // Acme's variants cost 20 and 22, so [21, 21] overlaps even though no
      // single variant costs exactly 21.
      expect(run({ priceRange: [21, 21] })).toEqual(["Acme Blue Tee"]);
    });

    it("excludes a product with no variants as soon as a price range applies", () => {
      const products = norm([product({ title: "No variants", variants: [] })]);
      expect(run({}, products)).toEqual([]);
    });
  });

  it("in-stock filter keeps products with at least one available variant", () => {
    expect(run({ inStockOnly: true })).toEqual(["Acme Blue Tee", "Beta Red Hoodie"]);
  });

  it("sale filter keeps products with a compare_at_price above price, even if sold out", () => {
    expect(run({ saleOnly: true })).toEqual(["Beta Red Hoodie", "Cedar Mug"]);
  });

  describe("sorting", () => {
    it("title-desc", () => {
      expect(run({ sortBy: "title-desc" })).toEqual([
        "Delta Cap",
        "Cedar Mug",
        "Beta Red Hoodie",
        "Acme Blue Tee",
      ]);
    });

    it("price-asc sorts by cheapest variant", () => {
      expect(run({ sortBy: "price-asc" })).toEqual([
        "Delta Cap",
        "Cedar Mug",
        "Acme Blue Tee",
        "Beta Red Hoodie",
      ]);
    });

    it("price-desc sorts by most expensive variant", () => {
      expect(run({ sortBy: "price-desc" })).toEqual([
        "Beta Red Hoodie",
        "Acme Blue Tee",
        "Cedar Mug",
        "Delta Cap",
      ]);
    });

    it("newest sorts by created_at descending", () => {
      expect(run({ sortBy: "newest" })).toEqual([
        "Cedar Mug",
        "Acme Blue Tee",
        "Beta Red Hoodie",
        "Delta Cap",
      ]);
    });

    it("discount-percent puts the deepest percentage discount first, ties keep input order", () => {
      expect(run({ sortBy: "discount-percent" })).toEqual([
        "Beta Red Hoodie", // 37.5%
        "Cedar Mug", // ~16.7%
        "Acme Blue Tee",
        "Delta Cap",
      ]);
    });

    it("discount-amount puts the largest absolute discount first", () => {
      expect(run({ sortBy: "discount-amount" })).toEqual([
        "Beta Red Hoodie", // 30
        "Cedar Mug", // 2.50
        "Acme Blue Tee",
        "Delta Cap",
      ]);
    });

    it("keeps input order for an unknown sort key", () => {
      expect(run({ sortBy: "bogus" })).toEqual([
        "Acme Blue Tee",
        "Beta Red Hoodie",
        "Cedar Mug",
        "Delta Cap",
      ]);
    });
  });

  it("combines filters", () => {
    expect(
      run({ selectedVendors: ["Acme"], saleOnly: true, sortBy: "price-asc" })
    ).toEqual(["Cedar Mug"]);
  });
});

describe("countActiveFilters", () => {
  const filterData = { minPrice: 5, maxPrice: 50 };
  const idle = { ...defaults, inStockOnly: true, priceRange: [5, 50] };
  const count = (state) => countActiveFilters({ ...idle, ...state }, filterData);

  it("is 0 when nothing differs from the post-load defaults", () => {
    expect(count({})).toBe(0);
  });

  it("counts each active filter group once, however many values are selected", () => {
    expect(count({ searchQuery: "x" })).toBe(1);
    expect(count({ selectedVendors: ["a", "b"] })).toBe(1);
    expect(count({ selectedTypes: ["a"] })).toBe(1);
    expect(count({ selectedTags: ["a", "b", "c"] })).toBe(1);
    expect(count({ selectedOptions: { option1: ["S"], option2: ["Blue"] } })).toBe(1);
    expect(count({ saleOnly: true })).toBe(1);
    expect(count({ priceRange: [6, 50] })).toBe(1);
  });

  it("counts turning the in-stock filter off as an active filter", () => {
    expect(count({ inStockOnly: false })).toBe(1);
  });

  it("does not count an option key whose values are empty", () => {
    expect(count({ selectedOptions: { option1: [] } })).toBe(0);
  });
});

describe("parseFilterParams", () => {
  it("returns null when there are no params or nothing valid", () => {
    expect(parseFilterParams("")).toBeNull();
    expect(parseFilterParams("?")).toBeNull();
    expect(parseFilterParams('?options=null')).toBeNull();
  });

  it("parses every supported param", () => {
    const parsed = parseFilterParams(
      "?q=hat&vendor=Acme&vendor=Beta&type=Mugs&tag=a&tag=b" +
        '&options=%7B%22option1%22%3A%5B%22S%22%5D%7D&inStock=0&sale=1' +
        "&minPrice=5&maxPrice=50&sort=price-asc"
    );
    expect(parsed).toEqual({
      searchQuery: "hat",
      selectedVendors: ["Acme", "Beta"],
      selectedTypes: ["Mugs"],
      selectedTags: ["a", "b"],
      selectedOptions: { option1: ["S"] },
      inStockOnly: false,
      saleOnly: true,
      priceRange: [5, 50],
      sortBy: "price-asc",
    });
  });

  it("keeps values containing commas intact (repeated params, not comma-joined)", () => {
    expect(parseFilterParams("?vendor=Acme%2C%20Inc.").selectedVendors).toEqual(["Acme, Inc."]);
  });

  it("drops empty values", () => {
    expect(parseFilterParams("?vendor=&vendor=Acme").selectedVendors).toEqual(["Acme"]);
  });

  it("treats inStock as on unless it is exactly 0, and sale as on only for 1", () => {
    expect(parseFilterParams("?inStock=1").inStockOnly).toBe(true);
    expect(parseFilterParams("?inStock=yes").inStockOnly).toBe(true);
    expect(parseFilterParams("?inStock=0").inStockOnly).toBe(false);
    expect(parseFilterParams("?sale=1").saleOnly).toBe(true);
    expect(parseFilterParams("?sale=true").saleOnly).toBe(false);
  });

  describe("options validation", () => {
    const optionsOf = (json) => parseFilterParams(`?q=x&options=${encodeURIComponent(json)}`).selectedOptions;

    it("accepts an object of arrays", () => {
      expect(optionsOf('{"option1":["S"],"option2":[]}')).toEqual({ option1: ["S"], option2: [] });
    });

    it.each([
      ["malformed JSON", "{oops"],
      ["null", "null"],
      ["an array", '["S"]'],
      ["a primitive", "5"],
      ["non-array values", '{"option1":"S"}'],
    ])("ignores %s", (_label, json) => {
      expect(optionsOf(json)).toBeUndefined();
    });
  });

  describe("price range validation", () => {
    it("requires both bounds", () => {
      expect(parseFilterParams("?minPrice=5&q=x").priceRange).toBeUndefined();
      expect(parseFilterParams("?maxPrice=5&q=x").priceRange).toBeUndefined();
    });

    it.each([
      ["Infinity", "?minPrice=Infinity&maxPrice=Infinity&q=x"],
      ["non-numeric", "?minPrice=a&maxPrice=b&q=x"],
      ["inverted", "?minPrice=50&maxPrice=5&q=x"],
    ])("ignores %s ranges", (_label, search) => {
      expect(parseFilterParams(search).priceRange).toBeUndefined();
    });

    it("accepts equal bounds", () => {
      expect(parseFilterParams("?minPrice=5&maxPrice=5").priceRange).toEqual([5, 5]);
    });
  });
});

describe("buildFilterSearch", () => {
  const filterData = { minPrice: 5, maxPrice: 50 };
  const idle = { ...defaults, inStockOnly: true, priceRange: [5, 50] };
  const build = (state = {}) => buildFilterSearch({ ...idle, ...state }, filterData);

  it("returns an empty string for the default view", () => {
    expect(build()).toBe("");
  });

  it("writes only non-default state", () => {
    expect(build({ searchQuery: "hat" })).toBe("?q=hat");
    expect(build({ inStockOnly: false })).toBe("?inStock=0");
    expect(build({ saleOnly: true })).toBe("?sale=1");
    expect(build({ sortBy: "newest" })).toBe("?sort=newest");
    expect(build({ priceRange: [10, 40] })).toBe("?minPrice=10&maxPrice=40");
  });

  it("repeats params for multi-value filters and keeps commas intact", () => {
    const search = build({ selectedVendors: ["Acme, Inc.", "Beta"], selectedTags: ["a"] });
    const params = new URLSearchParams(search);
    expect(params.getAll("vendor")).toEqual(["Acme, Inc.", "Beta"]);
    expect(params.getAll("tag")).toEqual(["a"]);
  });

  it("writes options as JSON keyed by optionN", () => {
    const search = build({ selectedOptions: { option1: ["S", "M"] } });
    expect(JSON.parse(new URLSearchParams(search).get("options"))).toEqual({ option1: ["S", "M"] });
  });

  it("round-trips through parseFilterParams", () => {
    const state = {
      searchQuery: "blue tee",
      selectedVendors: ["Acme, Inc."],
      selectedTypes: ["Shirts"],
      selectedTags: ["summer", "cotton"],
      selectedOptions: { option1: ["S"], option2: ["Blue"] },
      inStockOnly: false,
      saleOnly: true,
      priceRange: [10, 40],
      sortBy: "discount-percent",
    };
    expect(parseFilterParams(build(state))).toEqual(state);
  });
});
