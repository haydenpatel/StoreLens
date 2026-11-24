// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar";
import { setLocale } from "@/lib/locale";
import { computeFilterData } from "@/lib/filters";
import { createMatchMedia } from "@/lib/__fixtures__/fake-match-media";
import { DESKTOP_QUERY } from "@/lib/breakpoints";
import { readFileSync } from "node:fs";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = NoopObserver;
  window.matchMedia = createMatchMedia({ width: 1400 }).matchMedia;
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
    expect(screen.getByRole("button", { name: "Show 7 more in Vendor" })).toBeTruthy();
  });

  it("keeps a selected item in the hidden part visible, and counts only what is still hidden", () => {
    renderSidebar({
      filterData: { ...computeFilterData([product(10), product(20)]), vendors },
      selectedVendors: ["Vendor09"],
    });
    expect(checkbox("Vendor09").getAttribute("aria-checked")).toBe("true");
    expect(checkbox("Vendor06")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 6 more in Vendor" })).toBeTruthy();
  });

  it("keeps visible selections in order and still expands to everything", async () => {
    renderSidebar({
      filterData: { ...computeFilterData([product(10), product(20)]), vendors },
      selectedVendors: ["Vendor12", "Vendor08"],
    });
    const shown = screen.getAllByRole("checkbox").map((c) => c.parentElement.textContent).filter((t) => t.startsWith("Vendor"));
    expect(shown).toEqual(["Vendor01", "Vendor02", "Vendor03", "Vendor04", "Vendor05", "Vendor08", "Vendor12"]);
    await userEvent.click(screen.getByRole("button", { name: "Show 5 more in Vendor" }));
    expect(checkbox("Vendor06")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show less in Vendor" })).toBeTruthy();
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

describe("Sidebar counts (#115)", () => {
  it("groups the hidden count the way the locale does", () => {
    setLocale("de-DE");
    const vendors = names("Vendor", 1500);
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), vendors } });
    expect(screen.getByRole("button", { name: "Show 1.495 more in Vendor" })).toBeTruthy();
  });
});

describe("Sidebar tags", () => {
  it("makes every tag reachable, not just the first 20", async () => {
    const tags = names("tag", 45);
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), tags } });
    await userEvent.click(screen.getByRole("button", { name: "Show 40 more in Tags" }));
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
    window.matchMedia = createMatchMedia({ width: 800 }).matchMedia;
  };
  const desktop = () => {
    window.matchMedia = createMatchMedia({ width: 1400 }).matchMedia;
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

// Filter data that has something for every section, so a section that is missing
// is missing because of the platform's capabilities, not because it had no data.
// (A test over data with no vendors or tags would pass with the check removed.)
const richFilterData = () => ({
  ...computeFilterData([product(10), product(20)]),
  vendors: ["Acme", "Beta Co"],
  types: ["Shirts", "Mugs"],
  tags: ["summer", "cotton"],
  options: [{ name: "Size", key: "size", values: ["S", "M"] }],
});

describe("Sidebar sections follow the platform's capabilities", () => {
  const ALL = { vendors: true, categories: true, tags: true, variantOptions: true, variantStock: true };
  const sectionCheckbox = { Acme: "vendors", Shirts: "categories", summer: "tags", S: "variantOptions" };

  it("shows every section when the platform supports everything", () => {
    renderSidebar({ filterData: richFilterData(), capabilities: ALL });
    for (const name of [...Object.keys(sectionCheckbox), "In stock only"]) expect(checkbox(name)).toBeTruthy();
    expect(screen.getByText("Vendor")).toBeTruthy();
    expect(screen.getByText("Category")).toBeTruthy();
    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByText("Size")).toBeTruthy();
  });

  it("treats a capability the adapter doesn't mention as supported", () => {
    renderSidebar({ filterData: richFilterData() });
    for (const name of [...Object.keys(sectionCheckbox), "In stock only"]) expect(checkbox(name)).toBeTruthy();
  });

  it.each([
    ["vendors", "Vendor", "Acme"],
    ["categories", "Category", "Shirts"],
    ["tags", "Tags", "summer"],
    ["variantOptions", "Size", "S"],
  ])("hides the %s section when the platform lacks it, even though the data has values", (capability, title, value) => {
    renderSidebar({ filterData: richFilterData(), capabilities: { ...ALL, [capability]: false } });
    expect(screen.queryByText(title)).toBeNull();
    expect(checkbox(value)).toBeNull();
    // The other sections are untouched.
    for (const [other, key] of Object.entries(sectionCheckbox)) if (key !== capability) expect(checkbox(other)).toBeTruthy();
  });

  it("hides 'In stock only' when the platform doesn't report stock, and keeps 'On sale only'", () => {
    renderSidebar({ filterData: richFilterData(), capabilities: { ...ALL, variantStock: false } });
    expect(checkbox("In stock only")).toBeNull();
    expect(checkbox("On sale only")).toBeTruthy();
  });

  it("names the vendor and category sections from the platform's labels", () => {
    renderSidebar({ filterData: richFilterData(), labels: { vendors: "Artists", categories: "Collections" } });
    expect(screen.getByText("Artists")).toBeTruthy();
    expect(screen.getByText("Collections")).toBeTruthy();
    expect(screen.queryByText("Vendor")).toBeNull();
    expect(screen.queryByText("Category")).toBeNull();
  });

  it("leaves out a supported section that has no values", () => {
    renderSidebar({ filterData: { ...richFilterData(), vendors: [], types: [], tags: [], options: [] }, capabilities: ALL });
    for (const title of ["Vendor", "Category", "Tags", "Size"]) expect(screen.queryByText(title)).toBeNull();
  });
});

describe("Sidebar controls", () => {
  it("passes each toggled selection to its setter, adding to what is selected", async () => {
    const props = renderSidebar({ filterData: richFilterData(), selectedVendors: ["Acme"], selectedTypes: [], selectedTags: [], selectedOptions: {} });
    await userEvent.click(checkbox("Beta Co"));
    expect(props.setSelectedVendors).toHaveBeenLastCalledWith(["Acme", "Beta Co"]);
    await userEvent.click(checkbox("Acme"));
    expect(props.setSelectedVendors).toHaveBeenLastCalledWith([]);
    await userEvent.click(checkbox("Mugs"));
    expect(props.setSelectedTypes).toHaveBeenLastCalledWith(["Mugs"]);
    await userEvent.click(checkbox("cotton"));
    expect(props.setSelectedTags).toHaveBeenLastCalledWith(["cotton"]);
    await userEvent.click(checkbox("M"));
    expect(props.setSelectedOptions).toHaveBeenLastCalledWith({ size: ["M"] });
  });

  it("toggles 'In stock only' and 'On sale only'", async () => {
    const props = renderSidebar({ filterData: richFilterData(), inStockOnly: false, saleOnly: true });
    await userEvent.click(checkbox("In stock only"));
    expect(props.setInStockOnly).toHaveBeenCalledWith(true);
    await userEvent.click(checkbox("On sale only"));
    expect(props.setSaleOnly).toHaveBeenCalledWith(false);
  });

  it("sends typed search text to its setter and clears it from the clear button", async () => {
    const props = renderSidebar({ searchQuery: "" });
    await userEvent.type(screen.getByPlaceholderText("Search products..."), "x");
    expect(props.setSearchQuery).toHaveBeenLastCalledWith("x");
    cleanup();
    const withText = renderSidebar({ searchQuery: "tee" });
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(withText.setSearchQuery).toHaveBeenCalledWith("");
  });

  it("moves a price thumb from the keyboard, within the collection's prices", async () => {
    const props = renderSidebar();
    const [low, high] = screen.getAllByRole("slider");
    low.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(props.setPriceRange).toHaveBeenLastCalledWith([11, 20]);
    high.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(props.setPriceRange).toHaveBeenLastCalledWith([10, 19]);
  });

  it("enables Reset only while a filter is active, and calls onReset", async () => {
    const props = renderSidebar({ activeFilterCount: 2 });
    const reset = screen.getByRole("button", { name: /reset/i });
    expect(reset.disabled).toBe(false);
    await userEvent.click(reset);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});

describe("Sidebar accessible names (#145)", () => {
  it("names the search field and both price slider thumbs", () => {
    renderSidebar({ filterData: computeFilterData([product(10), product(20)]) });
    expect(screen.getByRole("textbox", { name: "Search products" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Minimum price" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Maximum price" })).toBeTruthy();
  });
});

describe("Sidebar option counts", () => {
  const filterData = {
    ...computeFilterData([product(10), product(20)]),
    options: [{ name: "Colour", key: "Colour", values: ["Black", "Red", "Blue"] }],
  };
  const optionCounts = (entries) => new Map([["colour", new Map(Object.entries(entries))]]);

  it("shows the product count after each value, and names it in the checkbox", () => {
    renderSidebar({ filterData, optionCounts: optionCounts({ black: 12, red: 3, blue: 1 }) });
    expect(checkbox("Black (12)")).toBeTruthy();
    expect(checkbox("Red (3)")).toBeTruthy();
  });

  it("marks a value with no products in its name and in text, not by dimming alone", () => {
    renderSidebar({ filterData, optionCounts: optionCounts({ black: 2 }) });
    const box = checkbox("Red (0), no matching products");
    expect(box).toBeTruthy();
    const label = document.querySelector(`label[for="${box.id}"]`);
    expect(label.textContent).toContain("(0)");
    expect(label.className).toContain("italic");
    expect(checkbox(/^Black \(2\)$/)).toBeTruthy();
  });

  it("keeps a selected value with a zero count visible and toggleable", async () => {
    const props = renderSidebar({
      filterData, optionCounts: optionCounts({ black: 2 }), selectedOptions: { Colour: ["Red"] },
    });
    const box = checkbox("Red (0), no matching products");
    expect(box.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(box);
    expect(props.setSelectedOptions).toHaveBeenCalledWith({ Colour: [] });
  });

  it("formats counts for the viewer's locale", () => {
    setLocale("de-DE");
    try {
      renderSidebar({ filterData, optionCounts: optionCounts({ black: 1234 }) });
      expect(checkbox("Black (1.234)")).toBeTruthy();
    } finally {
      setLocale("en-US");
    }
  });

  it("shows no counts when none are supplied", () => {
    renderSidebar({ filterData });
    expect(checkbox("Black")).toBeTruthy();
  });
});

describe("Sidebar long keys", () => {
  const prefix = "_tab_inside-drink-plant-recovery-smoothie-";
  const longA = `${prefix}130`;
  const longB = `${prefix}131`;

  it("renders a long key in full, with the full key as its title, in every group", () => {
    const filterData = {
      ...computeFilterData([product(10), product(20)]),
      vendors: [longA],
      types: [longA],
      tags: [longA],
      options: [{ name: "Flavour", key: "flavour", values: [longA] }],
    };
    renderSidebar({ filterData });
    const rows = screen.getAllByText(longA);
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row.getAttribute("title")).toBe(longA);
  });

  it("keeps two keys that share a long prefix as separate filters and selects only the one clicked", async () => {
    const props = renderSidebar({
      filterData: { ...computeFilterData([product(10), product(20)]), tags: [longA, longB] },
    });
    expect(checkbox(longA)).toBeTruthy();
    expect(checkbox(longB)).toBeTruthy();
    await userEvent.click(checkbox(longB));
    const update = props.setSelectedTags.mock.calls[0][0];
    expect(update).toEqual([longB]);
  });
});

describe("Sidebar option keys that name something on Object.prototype (#185, #193)", () => {
  const withOption = (name) => {
    const filterData = {
      ...computeFilterData([product(10), product(20)]),
      options: [{ name, key: name, values: ["S", "M"] }],
    };
    return filterData;
  };

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])(
    "renders an option named %s with nothing selected, and selects a value under that own key",
    async (name) => {
      const props = renderSidebar({ filterData: withOption(name) });
      expect(checkbox("S").getAttribute("aria-checked")).toBe("false");
      await userEvent.click(checkbox("S"));
      const [next] = props.setSelectedOptions.mock.calls[0];
      expect(Object.keys(next)).toEqual([name]);
      expect(next[name]).toEqual(["S"]);
    }
  );

  it("still shows and clears a value that is selected under such a key", async () => {
    const props = renderSidebar({ filterData: withOption("constructor"), selectedOptions: { constructor: ["S"] } });
    expect(checkbox("S").getAttribute("aria-checked")).toBe("true");
    await userEvent.click(checkbox("S"));
    expect(props.setSelectedOptions).toHaveBeenCalledWith({ constructor: [] });
  });
});

describe("Sidebar as a mobile drawer (#188, #193)", () => {
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let media;
  const at = (width, remPx) => {
    media = createMatchMedia({ width, remPx });
    window.matchMedia = media.matchMedia;
  };
  afterEach(() => {
    window.matchMedia = createMatchMedia({ width: 1400 }).matchMedia;
    document.documentElement.style.overflow = "";
  });

  const filterData = {
    ...computeFilterData([product(10), product(20)]),
    vendors: names("Vendor", 12),
  };

  // A page that owns the open state, with a button to open it from.
  function Harness({ onClose = () => {}, initiallyOpen = false }) {
    const [open, setOpen] = useState(initiallyOpen);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open filters</button>
        <Sidebar
          filterData={filterData}
          searchQuery=""
          setSearchQuery={() => {}}
          selectedVendors={[]}
          setSelectedVendors={() => {}}
          selectedTypes={[]}
          setSelectedTypes={() => {}}
          selectedTags={[]}
          setSelectedTags={() => {}}
          selectedOptions={{}}
          setSelectedOptions={() => {}}
          priceRange={[filterData.minPrice, filterData.maxPrice]}
          setPriceRange={() => {}}
          inStockOnly={false}
          setInStockOnly={() => {}}
          saleOnly={false}
          setSaleOnly={() => {}}
          onReset={() => {}}
          activeFilterCount={0}
          isOpen={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      </>
    );
  }
  const openDrawer = async (user) => {
    await user.click(screen.getByRole("button", { name: "Open filters" }));
    return screen.getByRole("dialog", { name: "Filters" });
  };

  it("closes on Escape", async () => {
    at(800);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const user = userEvent.setup();
    await openDrawer(user);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector("aside").hasAttribute("inert")).toBe(true);
  });

  it("closes from the Close button", async () => {
    at(800);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const user = userEvent.setup();
    await openDrawer(user);
    await user.click(screen.getByRole("button", { name: "Close filters" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", async () => {
    at(800);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const user = userEvent.setup();
    await openDrawer(user);
    await user.click(document.querySelector("aside").previousElementSibling);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus to Close on open and returns it to the opener on close", async () => {
    at(800);
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Open filters" });
    await openDrawer(user);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close filters" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(opener);
  });

  it("keeps Tab and Shift+Tab inside the drawer", async () => {
    at(800);
    render(<Harness />);
    const user = userEvent.setup();
    const dialog = await openDrawer(user);
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it("ignores Escape while the sidebar is docked", async () => {
    at(1400);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} initiallyOpen />);
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("becomes a dialog and docks again when the window crosses the breakpoint", () => {
    at(800);
    render(<Harness />);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeTruthy();
    act(() => media.resize({ width: 1400 }));
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    act(() => media.resize({ width: 800 }));
    expect(screen.queryByRole("dialog", { hidden: true })).toBeTruthy();
  });

  it("closes an open drawer when the window crosses the breakpoint, so it stays closed on the way back", async () => {
    at(800);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await openDrawer(userEvent.setup());
    expect(document.querySelector("aside").hasAttribute("inert")).toBe(false);

    act(() => media.resize({ width: 1400 }));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => media.resize({ width: 800 }));
    expect(document.querySelector("aside").hasAttribute("inert")).toBe(true);
  });

  it("does not call onClose on a breakpoint change while the drawer is closed", () => {
    at(800);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    act(() => media.resize({ width: 1400 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the same rem-based width as Tailwind's xl, so a larger default font size still gets the drawer", () => {
    // 1300px is wide enough at 16px per rem (80rem = 1280px) but not at 20px (1600px).
    at(1300, 20);
    render(<Harness />);
    expect(screen.getByRole("dialog", { hidden: true, name: "Filters" })).toBeTruthy();
    act(() => media.resize({ remPx: 16 }));
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("locks page scroll while the drawer is open and restores it on close", async () => {
    at(800);
    document.documentElement.style.overflow = "scroll";
    render(<Harness />);
    const user = userEvent.setup();
    expect(document.documentElement.style.overflow).toBe("scroll");
    await openDrawer(user);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.style.scrollbarGutter).toBe("stable");
    await user.keyboard("{Escape}");
    expect(document.documentElement.style.overflow).toBe("scroll");
    expect(document.documentElement.style.scrollbarGutter).toBe("");
  });

  it("releases the scroll lock when unmounted open, and never takes it while docked", () => {
    at(800);
    const { unmount } = render(<Harness initiallyOpen />);
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflow).toBe("");

    at(1400);
    render(<Harness initiallyOpen />);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("releases the scroll lock when the window crosses the breakpoint", async () => {
    at(800);
    render(<Harness />);
    await openDrawer(userEvent.setup());
    act(() => media.resize({ width: 1400 }));
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("stops scroll chaining out of the drawer's own scroll area", () => {
    at(800);
    render(<Harness />);
    const viewport = document.querySelector("aside [data-slot='scroll-area-viewport']");
    expect(viewport.className).toContain("max-xl:overscroll-contain");
  });
});

describe("Sidebar filter section semantics (#188)", () => {
  const vendors = names("Vendor", 12);

  it("names each filter section as a group", () => {
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), vendors, tags: ["a", "b"] } });
    const group = screen.getByRole("group", { name: "Vendor" });
    expect(group.contains(checkbox("Vendor01"))).toBe(true);
    expect(screen.getByRole("group", { name: "Tags" }).contains(checkbox("a"))).toBe(true);
    expect(group.contains(checkbox("a"))).toBe(false);
  });

  it("names the price range as a group around its slider", () => {
    renderSidebar({ filterData: computeFilterData([product(10), product(20)]) });
    const group = screen.getByRole("group", { name: /^Price Range:/ });
    expect(group.querySelectorAll("[role='slider']")).toHaveLength(2);
  });

  it("gives Show more its section name and a state that tracks the list", async () => {
    renderSidebar({ filterData: { ...computeFilterData([product(10), product(20)]), vendors } });
    const user = userEvent.setup();
    const more = screen.getByRole("button", { name: "Show 7 more in Vendor" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(screen.getByRole("group", { name: "Vendor" }).querySelector("[id]:not(label)").id);
    await user.click(more);
    const less = screen.getByRole("button", { name: "Show less in Vendor" });
    expect(less.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the desktop breakpoint", () => {
  it("is the same width as Tailwind's xl variant", () => {
    const css = readFileSync("src/index.css", "utf8");
    const xl = /--breakpoint-xl:\s*([^;]+);/.exec(css)?.[1];
    expect(DESKTOP_QUERY).toBe(`(min-width: ${xl})`);
  });
});
