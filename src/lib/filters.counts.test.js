import { afterEach, describe, expect, it } from "vitest";
import { computeFilterData, computeOptionCounts, filterAndSortProducts, prepareProducts } from "./filters";
import { setLocale } from "./locale";

afterEach(() => setLocale("en-US"));

const state = {
  searchQuery: "", selectedVendors: [], selectedTypes: [], selectedTags: [], selectedOptions: {},
  priceRange: [0, 10000], inStockOnly: false, saleOnly: false, sortBy: "title-asc",
};

// optionNames: ["Colour", "Size"]; variants: [[colour, size, available?, price?, compareAt?]]
const item = (title, optionNames, variants, extra = {}) => ({
  id: title, handle: title, title, description: "", currency: "USD",
  options: optionNames.map((name) => ({ name })),
  variants: variants.map(([a, b, available = true, price = 10, compareAtPrice]) => ({
    options: optionNames.length === 1 ? [a] : [a, b], available, price, compareAtPrice,
  })),
  ...extra,
});

// A value missing from the result has no products, so list every value of the
// collection with its count (0 when absent), as the sidebar reads it.
const counts = (products, overrides = {}, caps = {}) => {
  const result = computeOptionCounts(products, { ...state, ...overrides }, caps);
  const plain = (name) => {
    const option = computeFilterData(products).options.find((o) => o.key.toLowerCase() === name);
    return Object.fromEntries((option?.values ?? []).map((v) => [v.toLowerCase(), result.get(name)?.get(v.toLowerCase()) ?? 0]));
  };
  return { Colour: plain("colour"), Size: plain("size") };
};
const matching = (products, selectedOptions, overrides = {}) =>
  filterAndSortProducts(products, { ...state, ...overrides, selectedOptions }).length;

const shirt = item("Shirt", ["Colour", "Size"], [
  ["Black", "S"], ["Black", "L", false], ["Red", "S", false], ["Red", "L", false],
]);
const cap = item("Cap", ["Colour", "Size"], [["Black", "S"], ["Blue", "S"]]);
const mug = item("Mug", ["Colour"], [["Black"], ["White", undefined, false]]);

describe("computeOptionCounts", () => {
  it("counts products per value, not variants", () => {
    const products = [shirt, cap, mug];
    expect(counts(products)).toEqual({
      Colour: { black: 3, red: 1, blue: 1, white: 1 },
      Size: { s: 2, l: 1 },
    });
  });

  it("follows In stock only, and keeps a value with nothing in stock at 0", () => {
    expect(counts([shirt, cap, mug], { inStockOnly: true })).toEqual({
      Colour: { black: 3, red: 0, blue: 1, white: 0 },
      Size: { s: 2, l: 0 },
    });
  });

  it("does not apply an option's own selection to its own counts, but applies the others", () => {
    const products = [shirt, cap, mug];
    const selectedOptions = { Colour: ["Red"] };
    // Colour is unaffected by its own pick; Size sees only red variants (shirt S and L).
    expect(counts(products, { selectedOptions })).toEqual({
      Colour: { black: 3, red: 1, blue: 1, white: 1 },
      Size: { s: 1, l: 1 },
    });
  });

  it("needs one variant to meet every selection together", () => {
    // Black + L is out of stock, Red + S too: under Size L only Black's... nothing is in stock.
    const result = counts([shirt, cap], { selectedOptions: { Size: ["L"] }, inStockOnly: true });
    expect(result.Colour).toEqual({ black: 0, red: 0, blue: 0 });
    // Under Colour Black the sizes are those of in-stock black variants: S (both products).
    expect(counts([shirt, cap], { selectedOptions: { Colour: ["Black"] }, inStockOnly: true }).Size).toEqual({ s: 2, l: 0 });
  });

  it("keeps a selected value at 0 when nothing matches it", () => {
    const result = counts([shirt, cap], { selectedOptions: { Colour: ["Red"] }, inStockOnly: true });
    expect(result.Colour.red).toBe(0);
    expect(result.Colour.black).toBe(2);
  });

  it("counts a product once however many variants match (4 colours x 2 inseams x 9 sizes)", () => {
    const colours = ["Black", "Navy", "Olive", "Stone"];
    const inseams = ["30", "32"];
    const sizes = ["28", "30", "32", "34", "36", "38", "40", "42", "44"];
    const variants = [];
    colours.forEach((c) => inseams.forEach((i) => sizes.forEach((s) => variants.push({
      options: [c, i, s], available: !(c === "Navy" && i === "30"), price: 50,
    }))));
    const pants = {
      id: "p", title: "Cargo", currency: "USD", variants,
      options: [{ name: "Colour" }, { name: "Inseam" }, { name: "Size" }],
    };
    const all = computeOptionCounts([pants], state, {});
    expect(all.get("colour").get("black")).toBe(1);
    expect(all.get("size").get("34")).toBe(1);
    expect(all.get("inseam").get("30")).toBe(1);
    const stocked = computeOptionCounts([pants], { ...state, inStockOnly: true, selectedOptions: { Inseam: ["30"], Colour: ["Navy"] } }, {});
    // Navy has no 30" inseam in stock, so Size and Inseam-30 sizes under Navy+30 are 0...
    expect(stocked.get("size").get("34") ?? 0).toBe(0);
    // ...Colour (own selection ignored) still sees the 30" inseam: black yes, navy no.
    expect(stocked.get("colour").get("black")).toBe(1);
    expect(stocked.get("colour").get("navy") ?? 0).toBe(0);
    // Inseam (own ignored) sees navy only: 32" is in stock.
    expect(stocked.get("inseam").get("32")).toBe(1);
    expect(stocked.get("inseam").get("30") ?? 0).toBe(0);
  });

  it("applies price, sale and the search and vendor filters", () => {
    const products = prepareProducts([
      item("Red Hat", ["Colour"], [["Red", undefined, true, 5, 8], ["Green", undefined, true, 20]], { vendors: ["A"] }),
      item("Blue Hat", ["Colour"], [["Blue", undefined, true, 30]], { vendors: ["B"] }),
    ]);
    expect(counts(products, { saleOnly: true }).Colour).toEqual({ red: 1, green: 0, blue: 0 });
    expect(counts(products, { priceRange: [10, 40] }).Colour).toEqual({ red: 0, green: 1, blue: 1 });
    expect(counts(products, { searchQuery: "red" }).Colour).toEqual({ red: 1, green: 1, blue: 0 });
    expect(counts(products, { selectedVendors: ["B"] }).Colour).toEqual({ red: 0, green: 0, blue: 1 });
  });

  it("merges spellings of a value and of an option name", () => {
    const products = [
      item("A", ["Size"], [["Tall"]]),
      item("B", ["size"], [["tall"], [" TALL "]]),
    ];
    expect(counts(products).Size).toEqual({ tall: 2 });
  });

  it("leaves out a product that lacks a selected option, and counts nothing without options", () => {
    const result = counts([shirt, mug], { selectedOptions: { Size: ["S"] } });
    expect(result.Colour).toEqual({ black: 1, red: 1, white: 0 });
    expect(computeOptionCounts([shirt], state, { variantOptions: false }).size).toBe(0);
  });

  it("ignores selections and stock the platform can't provide", () => {
    const unstocked = item("U", ["Colour"], [["Red", undefined, false]]);
    expect(counts([unstocked], { inStockOnly: true }, { variantStock: false }).Colour).toEqual({ red: 1 });
  });

  it("agrees with what selecting each value returns (every value, mixed selections)", () => {
    const products = [
      shirt, cap, mug,
      item("Tee", ["Colour", "Size"], [["Red", "M", true, 12, 20], ["Blue", "M", false, 12], ["Blue", "L", true, 40]]),
      item("Hoodie", ["Size", "Colour"], [["S", "Red"], ["M", "Black", false]]),
      item("NoPrice", ["Colour", "Size"], [["Red", "S", true, NaN], ["Blue", "S", true, 99]]),
    ];
    const filterData = computeFilterData(products);
    const selections = [{}, { Colour: ["Red"] }, { Size: ["S"] }, { Colour: ["Black"], Size: ["S", "L"] }, { Colour: ["Blue", "Red"] }];
    const overrideSets = [{}, { inStockOnly: true }, { saleOnly: true }, { priceRange: [10, 50] }, { inStockOnly: true, priceRange: [10, 50] }];
    selections.forEach((selectedOptions) => overrideSets.forEach((overrides) => {
      const result = computeOptionCounts(products, { ...state, ...overrides, selectedOptions }, {});
      filterData.options.forEach((option) => option.values.forEach((value) => {
        // Selecting a value of an option that isn't already picked replaces nothing:
        // the count is the products matching the others plus this value alone.
        const others = { ...selectedOptions, [option.key]: [value] };
        const expected = matching(products, others, overrides);
        const actual = result.get(option.key.toLowerCase())?.get(value.toLowerCase()) ?? 0;
        expect(actual, `${option.key}=${value} ${JSON.stringify(selectedOptions)} ${JSON.stringify(overrides)}`).toBe(expected);
      }));
    }));
  });
});
