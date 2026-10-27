// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setLocale } from "@/lib/locale";
import ProductGrid from "./ProductGrid";

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.IntersectionObserver = NoopObserver;
  globalThis.ResizeObserver = NoopObserver;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

async function openSort(currency) {
  render(<ProductGrid products={[]} totalProducts={0} sortBy="title-asc" setSortBy={vi.fn()} currency={currency} />);
  await userEvent.click(screen.getByRole("combobox"));
}

describe("ProductGrid sort options", () => {
  it("labels the discount amount sort with the currency code when known", async () => {
    await openSort("CAD");
    expect(screen.getByRole("option", { name: "Discount (CAD): High to Low" })).toBeTruthy();
  });

  it("labels it with a bare $ when the currency is unknown", async () => {
    await openSort(undefined);
    expect(screen.getByRole("option", { name: "Discount $: High to Low" })).toBeTruthy();
  });
});

describe("ProductGrid keys (#113)", () => {
  it("renders a repeated product id without a duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = { id: 1, handle: "p", title: "Tee", images: [], tags: [], variants: [], currency: "USD" };
    render(<ProductGrid products={[p, p]} totalProducts={2} sortBy="title-asc" setSortBy={vi.fn()} currency="USD" />);
    expect(screen.getAllByText("Tee")).toHaveLength(2);
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});

describe("ProductGrid listing", () => {
  const item = (n) => ({ id: n, handle: `p${n}`, title: `Item ${n}`, images: [], tags: [], variants: [], currency: "USD" });
  const items = (n) => Array.from({ length: n }, (_, i) => item(i + 1));
  const grid = (products, extra = {}) => (
    <ProductGrid products={products} totalProducts={extra.total ?? products.length} sortBy="title-asc" setSortBy={extra.setSortBy ?? vi.fn()} currency="USD" />
  );

  it("shows how many of the collection's products match", () => {
    render(grid(items(3), { total: 10 }));
    expect(document.body.textContent).toContain("Showing 3 of 10 products");
  });

  it("groups the counts the way the locale does (#115)", () => {
    setLocale("de-DE");
    render(grid(items(1234), { total: 2000 }));
    expect(document.body.textContent).toContain("Showing 1.234 of 2.000 products");
    setLocale("en-US");
  });

  it("says nothing matches, with no cards, when the list is empty", () => {
    render(grid([], { total: 10 }));
    expect(screen.getByText("No products match your filters")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("reports the sort chosen", async () => {
    const setSortBy = vi.fn();
    render(grid(items(2), { setSortBy }));
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Price: Low to High" }));
    expect(setSortBy).toHaveBeenCalledWith("price-asc");
  });

  describe("revealing a long list a chunk at a time", () => {
    let callback;
    beforeAll(() => {
      globalThis.IntersectionObserver = class {
        constructor(cb) {
          callback = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });
    afterAll(() => {
      globalThis.IntersectionObserver = NoopObserver;
    });
    const cards = () => screen.getAllByRole("heading", { level: 3 }).length;

    it("mounts 60 cards, then more as the end of the grid comes into view, never past the list", async () => {
      render(grid(items(130)));
      expect(cards()).toBe(60);
      await act(async () => callback([{ isIntersecting: true }]));
      expect(cards()).toBe(120);
      await act(async () => callback([{ isIntersecting: true }]));
      expect(cards()).toBe(130);
    });

    it("ignores the sentinel while it is out of view", async () => {
      render(grid(items(130)));
      await act(async () => callback([{ isIntersecting: false }]));
      expect(cards()).toBe(60);
    });

    it("starts again from the top when the list changes", async () => {
      const { rerender } = render(grid(items(130)));
      await act(async () => callback([{ isIntersecting: true }]));
      expect(cards()).toBe(120);
      rerender(grid(items(100)));
      expect(cards()).toBe(60);
    });
  });
});
