// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar";
import { computeFilterData } from "@/lib/filters";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = NoopObserver;
  window.matchMedia = (query) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(cleanup);

const names = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);

const product = (price, extra = {}) => ({
  currency: "USD",
  variants: [{ price, options: [] }],
  ...extra,
});

function renderSidebar(overrides = {}) {
  const filterData = overrides.filterData ?? computeFilterData([product(10), product(20)]);
  const props = {
    filterData,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    selectedVendors: [],
    setSelectedVendors: vi.fn(),
    selectedTypes: [],
    setSelectedTypes: vi.fn(),
    selectedTags: [],
    setSelectedTags: vi.fn(),
    selectedOptions: {},
    setSelectedOptions: vi.fn(),
    priceRange: [filterData.minPrice, filterData.maxPrice],
    setPriceRange: vi.fn(),
    inStockOnly: false,
    setInStockOnly: vi.fn(),
    saleOnly: false,
    setSaleOnly: vi.fn(),
    onReset: vi.fn(),
    activeFilterCount: 0,
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

const checkbox = (name) => screen.queryByRole("checkbox", { name });

describe("Sidebar collapsed sections", () => {
  const vendors = names("Vendor", 12);

  it("starts collapsed to five items when a section has more than eight", () => {
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), vendors } });
    expect(checkbox("Vendor05")).toBeTruthy();
    expect(checkbox("Vendor06")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 7 more" })).toBeTruthy();
  });

  it("keeps a selected item in the hidden part visible, and counts only what is still hidden", () => {
    renderSidebar({
      filterData: { ...computeFilterData([product(10), product(20)]), vendors },
      selectedVendors: ["Vendor09"],
    });
    expect(checkbox("Vendor09").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Vendor06")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 6 more" })).toBeTruthy();
  });

  it("keeps visible selections in order and still expands to everything", async () => {
    renderSidebar({
      filterData: { ...computeFilterData([product(10), product(20)]), vendors },
      selectedVendors: ["Vendor12", "Vendor08"],
    });
    const shown = screen.getAllByRole("checkbox").map((c) => c.parentElement.textContent).filter((t) => t.startsWith("Vendor"));
    expect(shown).toEqual(["Vendor01", "Vendor02", "Vendor03", "Vendor04", "Vendor05", "Vendor08", "Vendor12"]);
    await userEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    expect(checkbox("Vendor06")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
  });

  it("offers no expand button when every hidden item is selected", () => {
    // Collapsing only happens above eight items: nine, with the four hidden ones selected.
    const nine = names("Vendor", 9);
    renderSidebar({
      filterData: { ...computeFilterData([product(10), product(20)]), vendors: nine },
      selectedVendors: nine.slice(5),
    });
    for (const v of nine) expect(checkbox(v)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });

  it("shows a selected option value from the hidden part of an option section", () => {
    const values = names("Size", 10);
    const filterData = { ...computeFilterData([product(10), product(20)]), options: [{ name: "Size", key: "Size", values }] };
    renderSidebar({ filterData, selectedOptions: { Size: ["Size10"] } });
    expect(checkbox("Size10").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Size07")).toBeNull();
  });
});

describe("Sidebar selections missing from the collection", () => {
  it("lists a selected value the collection doesn't have, so it can be cleared", async () => {
    const filterData = { ...computeFilterData([product(10), product(20)]), tags: ["a", "b"] };
    const props = renderSidebar({ filterData, selectedTags: ["from-a-link"] });
    const box = checkbox("from-a-link");
    expect(box.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(box);
    expect(props.setSelectedTags).toHaveBeenCalledWith([]);
  });
});

describe("Sidebar duplicate selections", () => {
  it("lists a repeated unknown selection once, with no duplicate-key warning, and one click clears it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const filterData = { ...computeFilterData([product(10), product(20)]), tags: ["a", "b"] };
    const props = renderSidebar({ filterData, selectedTags: ["x", "x"] });
    expect(screen.getAllByRole("checkbox", { name: "x" })).toHaveLength(1);
    await userEvent.click(checkbox("x"));
    expect(props.setSelectedTags).toHaveBeenCalledWith([]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("Sidebar tags", () => {
  it("makes every tag reachable, not just the first 20", async () => {
    const tags = names("tag", 45);
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), tags } });
    await userEvent.click(screen.getByRole("button", { name: "Show 40 more" }));
    for (const t of tags) expect(checkbox(t)).toBeTruthy();
  });

  it("shows a selected tag beyond the 20th without expanding", () => {
    const tags = names("tag", 45);
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), tags }, selectedTags: ["tag44"] });
    expect(checkbox("tag44").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Sidebar price range", () => {
  it("renders a slider with two thumbs when prices differ", () => {
    renderSidebar();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("shows the range with the currency code once", () => {
    renderSidebar({ filterData: computeFilterData([product(5, { currency: "CAD" }), product(730, { currency: "CAD" })]) });
    expect(screen.getByText(/Price Range/).textContent).toBe("Price Range: $5 - $730\u00a0CAD");
  });

  it("renders without errors and without a slider when every product costs the same", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const filterData = computeFilterData([product(20), product(20)]);
    expect(filterData.minPrice).toBe(filterData.maxPrice);
    expect(() => renderSidebar({ filterData })).not.toThrow();
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(screen.getByText(/Price Range/).textContent).toContain("Price Range: $20\u00a0USD");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("Sidebar dialog semantics and robustness (#113)", () => {
  const mobile = () => {
    window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  };
  const desktop = () => {
    window.matchMedia = (query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} });
  };
  afterEach(desktop);

  it("is a modal dialog named Filters below xl", () => {
    mobile();
    renderSidebar({ isOpen: true });
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("stays a plain landmark when docked at xl", () => {
    renderSidebar();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("aside").hasAttribute("aria-modal")).toBe(false);
  });

  it("renders the inactive Reset as a disabled button", () => {
    renderSidebar();
    const reset = screen.getByRole("button", { name: /reset/i });
    expect(reset.disabled).toBe(true);
  });

  it("gives every checkbox a unique id, even when sections share a title or value", () => {
    const filterData = {
      ...computeFilterData([product(10), product(20)]),
      vendors: ["Same Value", "a b"],
      types: ["Same Value"],
      tags: ["Same Value"],
    };
    renderSidebar({ filterData });
    const ids = screen.getAllByRole("checkbox").map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).not.toMatch(/\s/);
  });

  it("keeps focus on the Filters heading after Reset is clicked", async () => {
    mobile();
    const props = renderSidebar({ isOpen: true, activeFilterCount: 1 });
    await userEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(props.onReset).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Filters" }));
  });
});
