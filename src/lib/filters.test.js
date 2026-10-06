import { describe, it, expect } from "vitest";
import {
  buildFilterSearch,
  computeFilterData,
  countActiveFilters,
  filterAndSortProducts,
  parseFilterParams,
  restoreOptionSelections,
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

