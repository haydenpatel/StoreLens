import { describe, it, expect } from "vitest";
import {
  buildFilterSearch,
  computeFilterData,
  countActiveFilters,
  filterAndSortProducts,
  htmlToText,
  parseFilterParams,
  withSearchText,
  restoreListSelections,
  restoreOptionSelections,
  restorePriceRange,
} from "./filters";
import { normalizeShopifyProduct } from "./platforms/shopify";
import { normalizeFourthwallProduct } from "./platforms/fourthwall";
import { normalizeBigCartelProduct } from "./platforms/bigcartel";
import * as fw from "./__fixtures__/fourthwall";
import * as bc from "./__fixtures__/bigcartel";
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

  it("builds option groups keyed and labelled by option name", () => {
    const { options } = computeFilterData(catalog());
    expect(options).toEqual([
      { name: "Size", key: "Size", values: ["L", "M", "S"] },
      { name: "Color", key: "Color", values: ["Blue"] },
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

  describe("option groups across a store whose options sit at different positions", () => {
    it("gathers every product's option under its name, wherever it sits", () => {
      const { options } = computeFilterData(scatteredOptionsCatalog());
      expect(options).toEqual([
        { name: "Color", key: "Color", values: ["Black", "Navy", "Olive"] },
        // Shirt (option1), Jacket (option3) and Hat ("SIZE") all contribute.
        { name: "Size", key: "Size", values: ["Large", "Small", "X-Small"] },
        { name: "Length", key: "Length", values: ["Regular", "Short"] },
        { name: "Waist size", key: "Waist size", values: ["32", "34"] },
      ]);
    });

    it("has no Title or Default Title filter", () => {
      const names = computeFilterData(scatteredOptionsCatalog()).options.map((o) => o.name);
      expect(names).not.toContain("Title");
    });

    it("keeps differently named options separate", () => {
      const names = computeFilterData(scatteredOptionsCatalog()).options.map((o) => o.name);
      expect(names).toContain("Waist size");
      expect(names).toContain("Size");
    });

    it("lists options that more products have first, ties in first-seen order", () => {
      const names = computeFilterData(scatteredOptionsCatalog()).options.map((o) => o.name);
      expect(names).toEqual(["Color", "Size", "Length", "Waist size"]);
    });
  });

  describe("option label casing", () => {
    const named = (name) => product({ options: [{ name }], variants: [variant({ option1: "x" })] });
    const label = (...names) => computeFilterData(norm(names.map(named))).options[0].name;

    it("prefers a capitalised spelling over a lowercase one, however common", () => {
      expect(label("color", "color", "Color")).toBe("Color");
      expect(label("Color", "color")).toBe("Color");
    });

    it("prefers the most common capitalised spelling, first-seen on a tie", () => {
      expect(label("COLOUR", "Colour", "Colour")).toBe("Colour");
      expect(label("Colour", "COLOUR")).toBe("Colour");
    });

    it("never re-cases a label: a name that only exists lowercase stays that way", () => {
      expect(label("color")).toBe("color");
      expect(label("waist size")).toBe("waist size");
    });

    it("keeps brand-style casing accurate", () => {
      expect(label("iPhone model")).toBe("iPhone model");
      expect(label("eBook format", "eBook format")).toBe("eBook format");
      expect(label("SIZE")).toBe("SIZE");
    });

    it("trims whitespace", () => {
      expect(label(" Color ")).toBe("Color");
    });

    it("keeps the label usable as the filter key", () => {
      const [option] = computeFilterData(norm([named("Color")])).options;
      expect(option.key).toBe("Color");
    });
  });

  describe("option value casing", () => {
    const lengths = (...values) =>
      computeFilterData(
        norm([
          product({
            options: [{ name: "Length" }],
            variants: values.map((value) => variant({ option1: value })),
          }),
        ])
      ).options[0].values;

    it("condenses values that differ only by case", () => {
      expect(lengths("Tall", "tall", "Regular")).toEqual(["Regular", "Tall"]);
    });

    it("ignores surrounding whitespace", () => {
      expect(lengths("Tall", " Tall ", "Regular")).toEqual(["Regular", "Tall"]);
    });

    it("shows a capitalised spelling even if lowercase is more common", () => {
      expect(lengths("tall", "tall", "Tall")).toEqual(["Tall"]);
    });

    it("keeps a value that only exists in lowercase as it is", () => {
      expect(lengths("regular", "tall")).toEqual(["regular", "tall"]);
    });

    it("keeps values that are different apart", () => {
      expect(lengths("Tall", "Talls", "Small")).toEqual(["Small", "Tall", "Talls"]);
    });

    it("merges across products", () => {
      const products = norm([
        product({ options: [{ name: "Length" }], variants: [variant({ option1: "Tall" })] }),
        product({ options: [{ name: "length" }], variants: [variant({ option1: "tall" })] }),
      ]);
      expect(computeFilterData(products).options).toEqual([
        { name: "Length", key: "Length", values: ["Tall"] },
      ]);
    });
  });

  it("skips an option group none of whose variants have a value", () => {
    const products = norm([
      product({ options: [{ name: "Size" }], variants: [variant({ option1: null })] }),
    ]);
    expect(computeFilterData(products).options).toEqual([]);
  });

  it("reports the first currency found, if any", () => {
    expect(computeFilterData(catalog()).currency).toBeUndefined();
    const withCurrency = [{ ...catalog()[0], currency: "NZD" }, ...catalog().slice(1)];
    expect(computeFilterData(withCurrency).currency).toBe("NZD");
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

  describe("option filters (matched by option name)", () => {
    it("matches products with any variant having the option value", () => {
      expect(run({ selectedOptions: { Size: ["M"] } })).toEqual(["Acme Blue Tee"]);
      expect(run({ selectedOptions: { Size: ["S", "L"] } })).toEqual([
        "Acme Blue Tee",
        "Beta Red Hoodie",
      ]);
    });

    it("ANDs different option names, excluding products without that option", () => {
      // Beta Red Hoodie has a Size but no Color option.
      expect(run({ selectedOptions: { Size: ["L"], Color: ["Blue"] } })).toEqual([]);
      expect(run({ selectedOptions: { Size: ["M"], Color: ["Blue"] } })).toEqual(["Acme Blue Tee"]);
    });

    it("ignores an option name with no selected values", () => {
      expect(run({ selectedOptions: { Size: [] } })).toHaveLength(4);
    });

    it("matches option names ignoring case and surrounding whitespace", () => {
      expect(run({ selectedOptions: { " size ": ["M"] } })).toEqual(["Acme Blue Tee"]);
    });

    it("matches option values ignoring case and surrounding whitespace", () => {
      const products = norm([
        product({ title: "A", options: [{ name: "Length" }], variants: [variant({ option1: "Tall" })] }),
        product({ title: "B", options: [{ name: "Length" }], variants: [variant({ option1: "tall" })] }),
        product({ title: "C", options: [{ name: "Length" }], variants: [variant({ option1: "Regular" })] }),
      ]);
      expect(run({ selectedOptions: { Length: ["Tall"] } }, products)).toEqual(["A", "B"]);
      expect(run({ selectedOptions: { Length: [" TALL "] } }, products)).toEqual(["A", "B"]);
    });

    it("finds a size wherever it sits in each product's options", () => {
      // Size is option1 on Shirt, option3 on Jacket and named "SIZE" on Hat.
      const result = run({ selectedOptions: { Size: ["Large", "X-Small"] } }, scatteredOptionsCatalog());
      expect(result).toEqual(["Hat", "Jacket", "Shirt"]);
    });

    it("keeps different options apart", () => {
      expect(run({ selectedOptions: { "Waist size": ["32"] } }, scatteredOptionsCatalog())).toEqual(["Trousers"]);
      expect(run({ selectedOptions: { Size: ["32"] } }, scatteredOptionsCatalog())).toEqual([]);
    });

    it("matches nothing for a name no product has, including old positional keys", () => {
      expect(run({ selectedOptions: { Material: ["Cotton"] } })).toEqual([]);
      expect(run({ selectedOptions: { option1: ["M"] } })).toEqual([]);
    });
  });

  describe("price range", () => {
    it("includes products with a variant priced inside the filter range", () => {
      expect(run({ priceRange: [0, 10] })).toEqual(["Delta Cap"]);
      expect(run({ priceRange: [45, 60] })).toEqual(["Beta Red Hoodie"]);
      // Acme's variants cost 20 and 22: a range between them holds neither (#92).
      expect(run({ priceRange: [21, 21] })).toEqual([]);
      expect(run({ priceRange: [22, 22] })).toEqual(["Acme Blue Tee"]);
    });

    it("keeps a product with no variants or no usable price when a price range applies (#84)", () => {
      const products = norm([
        product({ title: "No variants", variants: [] }),
        product({ title: "Garbled", variants: [variant({ price: "n/a" })] }),
        product({ title: "Priced", variants: [variant({ price: "500.00" })] }),
      ]);
      expect(run({ priceRange: [0, 10] }, products)).toEqual(["Garbled", "No variants"]);
      expect(run({ priceRange: [0, 10], inStockOnly: true }, products)).toEqual(["Garbled", "No variants"]);
    });

    it("sorts unpriced products without NaN comparisons (#84)", () => {
      const products = norm([
        product({ title: "A none", variants: [] }),
        product({ title: "B cheap", variants: [variant({ price: "5.00" })] }),
        product({ title: "C none", variants: [] }),
      ]);
      expect(run({ sortBy: "price-asc" }, products)).toEqual(["B cheap", "A none", "C none"]);
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

    it("newest puts products with a missing or unreadable date last, keeping their input order", () => {
      const dated = (title, createdAt) => ({ ...catalog()[0], title, createdAt });
      const products = [
        dated("No date", undefined),
        dated("Old", "2025-01-01T00:00:00Z"),
        dated("Garbled", "sometime last week"),
        dated("New", "2026-06-01T00:00:00Z"),
        dated("Null date", null),
      ];
      expect(run({ sortBy: "newest" }, products)).toEqual(["New", "Old", "No date", "Garbled", "Null date"]);
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

    it("discount-percent ranks by each product's best percentage, ignoring sold-out variants (#114)", () => {
      const v = (price, compareAtPrice, available = true) => ({ price, compareAtPrice, available, options: [] });
      const mk = (title, variants) => ({ ...catalog()[0], title, variants });
      const products = [
        mk("Forty", [v(60, 100)]),
        mk("Mixed", [v(50, 100), v(300, 400)]), // best is 50%, not the 25% of the biggest saving
        mk("Sold-out deal", [v(50, 100, false), v(95, 100)]), // only 5% is buyable
      ];
      expect(run({ sortBy: "discount-percent" }, products)).toEqual(["Mixed", "Forty", "Sold-out deal"]);
      expect(run({ sortBy: "discount-amount" }, products)).toEqual(["Mixed", "Forty", "Sold-out deal"]);
    });

    it("sale-only counts a sold-out discount only while In stock only is on (#114)", () => {
      const v = (price, compareAtPrice, available) => ({ price, compareAtPrice, available, options: [] });
      const p = { ...catalog()[0], title: "Sold-out deal", variants: [v(50, 100, false), v(100, 100, true)] };
      expect(run({ saleOnly: true, inStockOnly: false }, [p])).toEqual(["Sold-out deal"]);
      expect(run({ saleOnly: true, inStockOnly: true }, [p])).toEqual([]);
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

  describe("search (#84)", () => {
    const withDescription = (title, description) =>
      norm([product({ title, body_html: description, variants: [variant({ price: "5.00" })] })])[0];

    it("matches the description's text, not its markup", () => {
      const products = [withDescription("Plain Tee", "<div><span>Soft cotton</span><p>Machine wash</p></div>")];
      expect(run({ searchQuery: "span" }, products)).toEqual([]);
      expect(run({ searchQuery: "div" }, products)).toEqual([]);
      expect(run({ searchQuery: "cotton" }, products)).toEqual(["Plain Tee"]);
    });

    it("strips tags once when products load", () => {
      const [loaded] = withSearchText([withDescription("Plain Tee", "<p>Soft &amp; warm</p>")]);
      expect(loaded.descriptionText).toBe("Soft & warm");
      expect(htmlToText(undefined)).toBe("");
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
    expect(count({ selectedOptions: { Size: ["S"], Color: ["Blue"] } })).toBe(1);
    expect(count({ saleOnly: true })).toBe(1);
    expect(count({ priceRange: [6, 50] })).toBe(1);
  });

  it("counts turning the in-stock filter off as an active filter", () => {
    expect(count({ inStockOnly: false })).toBe(1);
  });

  it("does not count an option key whose values are empty", () => {
    expect(count({ selectedOptions: { Size: [] } })).toBe(0);
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

    it("treats empty bounds as absent (#84)", () => {
      expect(parseFilterParams("?minPrice=&maxPrice=&q=x").priceRange).toBeUndefined();
      expect(parseFilterParams("?minPrice=&maxPrice=5&q=x").priceRange).toBeUndefined();
    });

    it("ignores an unknown sort value but keeps a known one (#84)", () => {
      expect(parseFilterParams("?sort=bogus&q=x").sortBy).toBeUndefined();
      expect(parseFilterParams("?sort=price-desc").sortBy).toBe("price-desc");
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

  it("writes options as JSON keyed by option name", () => {
    const search = build({ selectedOptions: { Size: ["S", "M"] } });
    expect(JSON.parse(new URLSearchParams(search).get("options"))).toEqual({ Size: ["S", "M"] });
  });

  it("leaves options with nothing selected out of the URL", () => {
    expect(build({ selectedOptions: { Size: [] } })).toBe("");
    const search = build({ selectedOptions: { Size: [], Color: ["Blue"] } });
    expect(JSON.parse(new URLSearchParams(search).get("options"))).toEqual({ Color: ["Blue"] });
  });

  it("round-trips through parseFilterParams", () => {
    const state = {
      searchQuery: "blue tee",
      selectedVendors: ["Acme, Inc."],
      selectedTypes: ["Shirts"],
      selectedTags: ["summer", "cotton"],
      selectedOptions: { Size: ["S"], Color: ["Blue"] },
      inStockOnly: false,
      saleOnly: true,
      priceRange: [10, 40],
      sortBy: "discount-percent",
    };
    expect(parseFilterParams(build(state))).toEqual(state);
  });
});

describe("capabilities", () => {
  const filterData = { minPrice: 5, maxPrice: 50 };
  const idle = { ...defaults, inStockOnly: true, priceRange: [5, 50] };
  const runWith = (state, capabilities) =>
    titles(filterAndSortProducts(catalog(), { ...defaults, ...state }, capabilities));

  describe("filterAndSortProducts", () => {
    it("ignores selections for filters the platform can't populate", () => {
      expect(runWith({ selectedVendors: ["Nobody"] }, { vendors: false })).toHaveLength(4);
      expect(runWith({ selectedTypes: ["Nope"] }, { categories: false })).toHaveLength(4);
      expect(runWith({ selectedTags: ["nope"] }, { tags: false })).toHaveLength(4);
      expect(runWith({ selectedOptions: { Size: ["Nope"] } }, { variantOptions: false })).toHaveLength(4);
    });

    it("still applies a selection when its capability is supported or unspecified", () => {
      expect(runWith({ selectedVendors: ["Nobody"] }, { vendors: true })).toEqual([]);
      expect(runWith({ selectedVendors: ["Nobody"] }, {})).toEqual([]);
    });

    it("applies other filters even when one is unsupported", () => {
      expect(runWith({ selectedVendors: ["Acme"], saleOnly: true }, { vendors: false })).toEqual([
        "Beta Red Hoodie",
        "Cedar Mug",
      ]);
    });

    it("doesn't filter by stock when the platform reports none", () => {
      expect(runWith({ inStockOnly: true }, { variantStock: false })).toHaveLength(4);
      expect(runWith({ inStockOnly: true }, { variantStock: true })).toHaveLength(2);
    });
  });

  describe("countActiveFilters", () => {
    const count = (state, capabilities) => countActiveFilters({ ...idle, ...state }, filterData, capabilities);

    it("doesn't count selections for unsupported filters", () => {
      expect(count({ selectedVendors: ["a"] }, { vendors: false })).toBe(0);
      expect(count({ selectedTypes: ["a"] }, { categories: false })).toBe(0);
      expect(count({ selectedTags: ["a"] }, { tags: false })).toBe(0);
      expect(count({ selectedOptions: { Size: ["S"] } }, { variantOptions: false })).toBe(0);
      expect(count({ selectedVendors: ["a"] }, { vendors: true })).toBe(1);
    });

    it("reads an unsupported stock filter as the untouched default", () => {
      expect(count({ inStockOnly: false }, { variantStock: false })).toBe(0);
      expect(count({ inStockOnly: false }, { variantStock: true })).toBe(1);
    });
  });

  describe("buildFilterSearch", () => {
    const build = (state, capabilities) => buildFilterSearch({ ...idle, ...state }, filterData, capabilities);

    it("drops unsupported selections from the URL", () => {
      expect(build({ selectedVendors: ["a"], selectedTags: ["t"] }, { vendors: false })).toBe("?tag=t");
      expect(build({ selectedTypes: ["a"] }, { categories: false })).toBe("");
      expect(build({ selectedOptions: { Size: ["S"] } }, { variantOptions: false })).toBe("");
    });

    it("doesn't write inStock=0 for a platform without stock data", () => {
      expect(build({ inStockOnly: false }, { variantStock: false })).toBe("");
      expect(build({ inStockOnly: false }, { variantStock: true })).toBe("?inStock=0");
    });
  });
});

describe("restoreOptionSelections", () => {
  const products = scatteredOptionsCatalog();
  const filterOptions = computeFilterData(products).options;
  const restore = (selected) => restoreOptionSelections(selected, filterOptions);

  it("keeps selections for options the collection has", () => {
    expect(restore({ Color: ["Black"], Length: ["Short"] })).toEqual({
      options: { Color: ["Black"], Length: ["Short"] },
      ignored: [],
    });
  });

  it("matches names ignoring case and whitespace, returning the filter's spelling", () => {
    expect(restore({ size: ["Large"], " WAIST SIZE ": ["32"] })).toEqual({
      options: { Size: ["Large"], "Waist size": ["32"] },
      ignored: [],
    });
  });

  it("matches values ignoring case and whitespace, returning the filter's spelling", () => {
    expect(restore({ size: ["large", " X-SMALL "] }).options).toEqual({ Size: ["Large", "X-Small"] });
  });

  it("de-duplicates values that match once their case is aligned", () => {
    expect(restore({ Size: ["Large", "large"] }).options).toEqual({ Size: ["Large"] });
  });

  it("merges keys that name the same option", () => {
    expect(restore({ color: ["Navy"], Color: ["Black", "navy"] }).options).toEqual({
      Color: ["Navy", "Black"],
    });
  });

  it("drops and reports a value the option doesn't have", () => {
    expect(restore({ Size: ["Large", "Gigantic"] })).toEqual({
      options: { Size: ["Large"] },
      ignored: ["Size: Gigantic"],
    });
  });

  it("leaves out an option none of whose saved values apply", () => {
    expect(restore({ Size: ["Gigantic"], Color: ["Black"] })).toEqual({
      options: { Color: ["Black"] },
      ignored: ["Size: Gigantic"],
    });
  });

  it("reports each unknown name and value", () => {
    expect(restore({ Material: ["Cotton"], Size: ["Nope", "Large"] }).ignored).toEqual([
      "Material",
      "Size: Nope",
    ]);
  });

  it("reports an unknown value in the filter's spelling of the option name", () => {
    expect(restore({ size: ["Gigantic"] }).ignored).toEqual(["Size: Gigantic"]);
  });

  it("drops and reports an option the collection doesn't have", () => {
    expect(restore({ Material: ["Cotton"], Size: ["Large"] })).toEqual({
      options: { Size: ["Large"] },
      ignored: ["Material"],
    });
  });

  it("doesn't report an unknown option that has nothing selected", () => {
    expect(restore({ Material: [], Size: ["Large"] })).toEqual({
      options: { Size: ["Large"] },
      ignored: [],
    });
  });

  it("no longer understands old positional keys: they are dropped and reported", () => {
    expect(restore({ option1: ["Black"], option2: ["Short"] })).toEqual({
      options: {},
      ignored: ["option1", "option2"],
    });
  });

  it("returns nothing for no selections", () => {
    expect(restore({})).toEqual({ options: {}, ignored: [] });
  });

  it("produces keys that filter correctly after a link is restored", () => {
    const { options } = restore({ size: ["large"] });
    const result = titles(
      filterAndSortProducts(norm(rawScatteredOptionsCatalog()), { ...defaults, selectedOptions: options })
    );
    expect(result).toEqual(["Jacket", "Shirt"]);
  });
});

describe("restoreListSelections", () => {
  const available = ["Acme", "Beta Co"];

  it("returns matches in the collection's spelling, ignoring case and whitespace", () => {
    expect(restoreListSelections(["ACME", " beta co "], available)).toEqual({
      values: ["Acme", "Beta Co"],
      ignored: [],
    });
  });

  it("drops and reports a value the collection doesn't have", () => {
    expect(restoreListSelections(["Acme", "Nope"], available)).toEqual({ values: ["Acme"], ignored: ["Nope"] });
  });

  it("de-duplicates values that match once their case is aligned", () => {
    expect(restoreListSelections(["Acme", "acme"], available).values).toEqual(["Acme"]);
  });

  it("selects every spelling the collection has, unless the value matches one exactly", () => {
    const spelled = ["Acme", "ACME", "acme", "Beta Co"];
    expect(restoreListSelections(["aCME"], spelled).values).toEqual(["Acme", "ACME", "acme"]);
    expect(restoreListSelections(["ACME"], spelled).values).toEqual(["ACME"]);
  });

  it("drops everything when the collection has no values", () => {
    expect(restoreListSelections(["Acme"], [])).toEqual({ values: [], ignored: ["Acme"] });
  });
});

describe("restorePriceRange", () => {
  it("keeps a range inside the collection's prices", () => {
    expect(restorePriceRange([12, 18], 10, 20)).toEqual([12, 18]);
  });

  it("clamps a range that sticks out", () => {
    expect(restorePriceRange([0, 15], 10, 20)).toEqual([10, 15]);
    expect(restorePriceRange([15, 500], 10, 20)).toEqual([15, 20]);
  });

  it("drops a range that doesn't overlap the collection's prices", () => {
    expect(restorePriceRange([1000, 2000], 10, 20)).toBeNull();
    expect(restorePriceRange([1, 5], 10, 20)).toBeNull();
  });

  it("keeps a range that only touches an end", () => {
    expect(restorePriceRange([20, 30], 10, 20)).toEqual([20, 20]);
  });
});

// #92: variant-level filters are ANDed into one test per variant.
describe("filtering per variant (#92)", () => {
  const v = (options, price, extra = {}) => ({
    id: options.join("/") || "v",
    title: options.join(" / "),
    price,
    compareAtPrice: null,
    available: true,
    options,
    ...extra,
  });
  const make = (title, variants, optionNames = ["Size", "Color"]) => ({
    id: title,
    handle: title,
    title,
    url: null,
    images: [],
    vendors: [],
    categories: [],
    tags: [],
    available: true,
    variants,
    options: optionNames.map((name) => ({ name, values: [] })),
  });
  const base = { ...defaults, inStockOnly: false };
  const filter = (products, state = {}) => filterAndSortProducts(products, { ...base, ...state });
  const names = (products) => products.map((p) => p.title);
  const prices = (p) => (p.matchingVariants ?? p.variants).map((x) => x.price);

  it("needs one variant to match every selected option", () => {
    const split = make("Split", [v(["S", "Red"], 10), v(["M", "Blue"], 10)]);
    const both = make("Both", [v(["S", "Blue"], 10), v(["M", "Red"], 10)]);
    const result = filter([split, both], { selectedOptions: { Size: ["S"], Color: ["Blue"] } });
    expect(names(result)).toEqual(["Both"]);
    expect(result[0].matchingVariants.map((x) => x.title)).toEqual(["S / Blue"]);
  });

  it("ORs the values of one option", () => {
    const tee = make("Tee", [v(["S", "Red"], 10), v(["M", "Red"], 20), v(["L", "Red"], 30)]);
    const [result] = filter([tee], { selectedOptions: { Size: ["S", "L"] } });
    expect(prices(result)).toEqual([10, 30]);
  });

  describe("In stock only", () => {
    const tee = make("Tee", [v(["S", "Blue"], 10, { available: false }), v(["S", "Red"], 10), v(["M", "Blue"], 10)]);
    it("hides a product whose only matching variant is sold out", () => {
      const state = { selectedOptions: { Size: ["S"], Color: ["Blue"] } };
      expect(names(filter([tee], { ...state, inStockOnly: true }))).toEqual([]);
      expect(names(filter([tee], { ...state, inStockOnly: false }))).toEqual(["Tee"]);
    });

    it("does not narrow the card or sorts by itself", () => {
      const half = make("Half", [v(["S", "Red"], 10, { available: false }), v(["M", "Red"], 50)]);
      const [result] = filter([half], { inStockOnly: true });
      expect(result).toBe(half);
      expect(result.matchingVariants).toBeUndefined();
    });

    it("counts only in-stock matches once something else narrows", () => {
      const [result] = filter([tee], { selectedOptions: { Size: ["S"] }, inStockOnly: true });
      expect(result.matchingVariants.map((x) => x.title)).toEqual(["S / Red"]);
    });

    it("lets the card read sold out when the matching variants are", () => {
      const soldOut = make("Sold", [v(["S", "Red"], 10, { available: false }), v(["M", "Red"], 10)]);
      const [result] = filter([soldOut], { selectedOptions: { Size: ["S"] }, inStockOnly: false });
      expect(result.matchingVariants.some((x) => x.available)).toBe(false);
    });
  });

  it("applies the price range to the matching variants", () => {
    const tee = make("Tee", [v(["S", "Red"], 50), v(["M", "Red"], 10)]);
    expect(names(filter([tee], { selectedOptions: { Size: ["S"] }, priceRange: [0, 20] }))).toEqual([]);
    expect(names(filter([tee], { selectedOptions: { Size: ["M"] }, priceRange: [0, 20] }))).toEqual(["Tee"]);
    const [narrowed] = filter([tee], { priceRange: [0, 20] });
    expect(prices(narrowed)).toEqual([10]);
  });

  it("keeps the #119 sale rule: in-stock discounts count only while In stock only is on", () => {
    const tee = make("Tee", [
      v(["S", "Red"], 10, { compareAtPrice: 20, available: false }),
      v(["M", "Red"], 20),
    ]);
    expect(names(filter([tee], { saleOnly: true, inStockOnly: true }))).toEqual([]);
    expect(names(filter([tee], { saleOnly: true, inStockOnly: false }))).toEqual(["Tee"]);
  });

  it("applies On sale only to the selected options' variants", () => {
    const tee = make("Tee", [v(["S", "Red"], 20), v(["M", "Red"], 10, { compareAtPrice: 20 })]);
    expect(names(filter([tee], { saleOnly: true, selectedOptions: { Size: ["S"] } }))).toEqual([]);
    expect(names(filter([tee], { saleOnly: true, selectedOptions: { Size: ["M"] } }))).toEqual(["Tee"]);
  });

  it("does not treat a compare-at price at or below the price as a sale", () => {
    const tee = make("Tee", [v(["S", "Red"], 20, { compareAtPrice: 20 }), v(["M", "Red"], 20, { compareAtPrice: 10 })]);
    expect(names(filter([tee], { saleOnly: true }))).toEqual([]);
  });

  describe("a product with no variants", () => {
    const empty = make("Empty", []);
    it("stays when only the stock or price filters apply", () => {
      expect(names(filter([empty], { inStockOnly: true, priceRange: [0, 5] }))).toEqual(["Empty"]);
    });
    it("can't match an option or sale filter", () => {
      expect(names(filter([empty], { selectedOptions: { Size: ["S"] } }))).toEqual([]);
      expect(names(filter([empty], { saleOnly: true }))).toEqual([]);
    });
  });

  it("never matches a variant missing an option value, and doesn't throw", () => {
    const tee = make("Tee", [v(["S"], 10), v(["", "Blue"], 10), v([undefined, "Blue"], 10)]);
    expect(names(filter([tee], { selectedOptions: { Size: ["S"], Color: ["Blue"] } }))).toEqual([]);
    const [result] = filter([tee], { selectedOptions: { Color: ["Blue"] } });
    expect(result.matchingVariants).toHaveLength(2);
  });

  it("excludes a single default-variant product from any option filter", () => {
    const mug = make("Mug", [v([], 10)], []);
    expect(names(filter([mug], { selectedOptions: { Size: ["S"] } }))).toEqual([]);
  });

  describe("with no variant-level filter narrowing", () => {
    it("returns the same products in the same order, without matchingVariants", () => {
      const products = catalog();
      const state = { ...defaults, inStockOnly: true, priceRange: [5, 50] };
      const result = filterAndSortProducts(products, state);
      expect(result.every((p) => p.matchingVariants === undefined)).toBe(true);
      expect(titles(result)).toEqual(["Acme Blue Tee", "Beta Red Hoodie"]);
      expect(result[0]).toBe(products.find((p) => p.title === "Acme Blue Tee"));
    });
  });

  it("sorts prices and discounts by the matching variants", () => {
    const a = make("A", [v(["S", "Red"], 50, { compareAtPrice: 60 }), v(["M", "Red"], 5, { compareAtPrice: 100 })]);
    const b = make("B", [v(["S", "Red"], 20, { compareAtPrice: 40 }), v(["M", "Red"], 60)]);
    const state = { selectedOptions: { Size: ["S"] } };
    expect(names(filter([a, b], { ...state, sortBy: "price-asc" }))).toEqual(["B", "A"]);
    expect(names(filter([a, b], { ...state, sortBy: "price-desc" }))).toEqual(["A", "B"]);
    expect(names(filter([a, b], { ...state, sortBy: "discount-percent" }))).toEqual(["B", "A"]);
    // Without the selection the sorts see every variant.
    expect(names(filter([a, b], { sortBy: "discount-percent" }))).toEqual(["A", "B"]);
    expect(names(filter([a, b], { sortBy: "price-asc" }))).toEqual(["A", "B"]);
  });

  it("doesn't narrow, or match on, a variant with no usable price when the others are priced", () => {
    const tee = make("Tee", [v(["S", "Red"], NaN), v(["M", "Red"], 50)]);
    const [kept] = filter([tee], { priceRange: [0, 100] });
    expect(kept).toBe(tee);
    expect(names(filter([tee], { priceRange: [0, 10] }))).toEqual([]);
    expect(names(filter([make("None", [v(["S", "Red"], NaN)])], { priceRange: [0, 10] }))).toEqual(["None"]);
  });

  it("matches a price-narrowed product by the price-range ends inclusively", () => {
    const tee = make("Tee", [v(["S", "Red"], 20), v(["M", "Red"], 30)]);
    expect(names(filter([tee], { priceRange: [20, 20] }))).toEqual(["Tee"]);
  });

  describe("Fourthwall (stock and compare-at are per product)", () => {
    const origin = "https://shop.example.com";
    const tee = normalizeFourthwallProduct(
      fw.product({
        title: "Example Tee",
        variants: ["Black, XS", "Black, S", "Vintage Black, XS", "Vintage Black, S"].map((t) => fw.variant(t)),
      }),
      origin
    );
    const uneven = normalizeFourthwallProduct(
      fw.product({ title: "Uneven", variants: [fw.variant("Black, XS"), fw.variant("Black"), fw.variant("XS")] }),
      origin
    );
    const soldOut = normalizeFourthwallProduct(fw.product({ title: "Sold Out Tee", available: false }), origin);

    it("matches a combined colour and size on one variant", () => {
      // The colour part has no name in the feed, so it is guessed as "Option 1".
      expect(tee.options.map((o) => o.name)).toEqual(["Option 1", "Size"]);
      const [result] = filter([tee], { selectedOptions: { "Option 1": ["Black"], Size: ["XS"] } });
      expect(result.matchingVariants.map((x) => x.title)).toEqual(["Black, XS"]);
      expect(names(filter([tee], { selectedOptions: { "Option 1": ["Black"], Size: ["M"] } }))).toEqual([]);
    });

    it("lines every variant's options up with the product's options", () => {
      expect(tee.variants.map((x) => x.options)).toEqual([
        ["Black", "XS"], ["Black", "S"], ["Vintage Black", "XS"], ["Vintage Black", "S"],
      ]);
    });

    it("treats a product whose titles have different numbers of parts as one option of whole titles", () => {
      expect(uneven.options.map((o) => o.name)).toEqual(["Option 1"]);
      expect(uneven.variants.map((x) => x.options)).toEqual([["Black, XS"], ["Black"], ["XS"]]);
      const [result] = filter([uneven], { selectedOptions: { "Option 1": ["Black"] } });
      expect(result.matchingVariants.map((x) => x.title)).toEqual(["Black"]);
      expect(names(filter([uneven], { selectedOptions: { Size: ["XS"] } }))).toEqual([]);
    });

    it("stock can't narrow by variant: a sold-out product has no in-stock variant at all", () => {
      expect(names(filter([soldOut], { inStockOnly: true }))).toEqual([]);
      expect(names(filter([soldOut], { inStockOnly: false }))).toEqual(["Sold Out Tee"]);
      expect(new Set(tee.variants.map((x) => x.available)).size).toBe(1);
    });
  });

  describe("Big Cartel (stock and sale are per option)", () => {
    const shirt = normalizeBigCartelProduct(
      bc.sized({ name: "Sized" }, ["S", "M", "L"], { soldOut: ["S"] }),
      "https://shop.example.com",
      "USD"
    );

    it("hides a product whose only selected size is sold out, and keeps one with another size in stock", () => {
      const state = { selectedOptions: { Size: ["S"] } };
      expect(names(filter([shirt], { ...state, inStockOnly: true }))).toEqual([]);
      expect(names(filter([shirt], { ...state, inStockOnly: false }))).toEqual(["Sized"]);
      expect(names(filter([shirt], { selectedOptions: { Size: ["S", "M"] }, inStockOnly: true }))).toEqual(["Sized"]);
    });

    it("carries per-option sale and sold-out flags onto the variants", () => {
      const onSale = normalizeBigCartelProduct(
        bc.sized({ name: "Sale", on_sale: true, default_price: 30 }, ["S", "M"], { price: 20 }),
        "https://shop.example.com",
        "USD"
      );
      expect(names(filter([onSale], { saleOnly: true, selectedOptions: { Size: ["M"] } }))).toEqual(["Sale"]);
    });
  });
});
