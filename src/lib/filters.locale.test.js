import { afterEach, describe, expect, it } from "vitest";
import { computeFilterData, filterAndSortProducts, foldText, withSearchText } from "./filters";
import { setLocale } from "./locale";

afterEach(() => setLocale("en-US"));

const state = {
  searchQuery: "", selectedVendors: [], selectedTypes: [], selectedTags: [], selectedOptions: {},
  priceRange: [0, 10000], inStockOnly: false, saleOnly: false, sortBy: "title-asc",
};
const item = (title, extra = {}) => ({ id: title, handle: title, title, description: "", variants: [], ...extra });
const run = (products, overrides = {}) => filterAndSortProducts(products, { ...state, ...overrides }).map((p) => p.title);

describe("search folding (#115)", () => {
  const products = withSearchText([
    item("Café Mug"),
    item("CAFÉ Bowl"),
    item("Plain Tee", { description: "<p>Served at the café</p>" }),
    item("Other"),
  ]);

  it.each(["en-US", "tr-TR", "de-DE"])("finds cafe, Café and CAFÉ alike in %s", (tag) => {
    setLocale(tag);
    for (const query of ["cafe", "Café", "CAFÉ", "café"]) {
      expect(run(products, { searchQuery: query, sortBy: "newest" }).sort()).toEqual(["CAFÉ Bowl", "Café Mug", "Plain Tee"]);
    }
  });

  it("gives a shared ?q= link the same products in en-US and tr-TR", () => {
    const list = withSearchText([item("ISTANBUL Tee"), item("İstanbul Cap"), item("istanbul Bag")]);
    const results = ["en-US", "tr-TR"].map((tag) => {
      setLocale(tag);
      return run(list, { searchQuery: "istanbul" }).sort();
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toHaveLength(3);
  });

  it("works on products that were not given search text", () => {
    expect(run([item("Café")], { searchQuery: "cafe" })).toEqual(["Café"]);
  });

  it("folds diacritics and case but not ß, ø or ligatures (accepted)", () => {
    expect(foldText("Crème Brûlée ÀÉÎ")).toBe("creme brulee aei");
    expect(foldText("Straße")).toBe("straße");
    expect(foldText("Ørsted")).toBe("ørsted");
    expect(foldText("Æon")).toBe("æon");
    expect(foldText(undefined)).toBe("");
  });

  it("leaves non-Latin scripts intact", () => {
    expect(foldText("が")).toBe("が");
    expect(foldText("が")).not.toBe("か");
    expect(foldText("कि")).toBe("कि");
    expect(foldText("가")).toBe("가");
    const list = withSearchText([item("각"), item("가"), item("か"), item("が")]);
    expect(run(list, { searchQuery: "가" })).toEqual(["가"]);
    expect(run(list, { searchQuery: "か" })).toEqual(["か"]);
    expect(run(list, { searchQuery: "が" })).toEqual(["が"]);
    expect(foldText("Crème CAFÉ İstanbul")).toBe("creme cafe istanbul");
  });
});

describe("sorting (#115)", () => {
  it("sorts the sidebar lists with capitalised names among the others", () => {
    const data = computeFilterData([
      item("a", { vendors: ["Zebra", "apple", "Apple"], categories: ["Éclair", "Zip", "eel"], tags: ["b", "B", "a"] }),
    ]);
    expect(data.vendors).toEqual(["Apple", "apple", "Zebra"]);
    expect(data.types).toEqual(["Éclair", "eel", "Zip"]);
    expect(data.tags).toEqual(["a", "B", "b"]);
  });

  it("sorts option values numerically", () => {
    const data = computeFilterData([
      item("a", {
        options: [{ name: "Size" }],
        variants: ["10", "2", "1", "M"].map((v) => ({ price: 1, options: [v] })),
      }),
    ]);
    expect(data.options[0].values).toEqual(["1", "2", "10", "M"]);
  });

  it("sorts titles with the same collator, in both directions", () => {
    const products = ["Zebra", "Item 10", "apple", "Item 2", "Éclair"].map((t) => item(t));
    expect(run(products)).toEqual(["apple", "Éclair", "Item 2", "Item 10", "Zebra"]);
    expect(run(products, { sortBy: "title-desc" })).toEqual(["Zebra", "Item 10", "Item 2", "Éclair", "apple"]);
  });
});
