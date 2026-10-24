// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ProductCard from "./ProductCard";

afterEach(cleanup);

const NB = " ";
const variant = (price, compareAtPrice = null) => ({ id: price, title: "", price, compareAtPrice, available: true, options: [] });
const product = (currency, variants) => ({ id: 1, handle: "p", title: "Tee", images: [], tags: [], variants, currency });
const text = () => document.body.textContent;

describe("ProductCard currency", () => {
  it("shows the price range with the code once", () => {
    render(<ProductCard product={product("CAD", [variant(5), variant(730)])} />);
    expect(text()).toContain(`$5.00 - $730.00${NB}CAD`);
  });

  it("shows the sale badge with the currency code", () => {
    render(<ProductCard product={product("CAD", [variant(20, 30)])} />);
    expect(text()).toContain(`Save $10.00${NB}CAD (33% off)`);
  });

  it("shows a range when in-stock discounted variants differ (#114)", () => {
    render(<ProductCard product={product("CAD", [variant(50, 100), variant(300, 400)])} />);
    expect(text()).toContain(`Save $50.00 - $100.00${NB}CAD (25-50% off)`);
    // phone-width fallback uses the best-percentage variant's own saving
    expect(text()).toContain(`Save up to $50.00${NB}CAD (50% off)`);
  });

  it("shows one saving when the savings are equal after rounding to cents (#124)", () => {
    render(<ProductCard product={product("CAD", [variant(9.99, 19.99), variant(19.99, 29.99)])} />);
    expect(text()).toContain(`Save $10.00${NB}CAD (33-50% off)`);
    expect(text()).not.toContain("$10.00 - $10.00");
    expect(text()).toContain(`Save up to $10.00${NB}CAD (50% off)`);
  });

  it("still shows a range when savings differ by a cent (#124)", () => {
    render(<ProductCard product={product("CAD", [variant(9.99, 19.99), variant(19.98, 29.99)])} />);
    expect(text()).toContain(`Save $10.00 - $10.01${NB}CAD`);
  });

  it("shows one percentage when only the saving differs (#114)", () => {
    render(<ProductCard product={product("CAD", [variant(50, 100), variant(100, 200)])} />);
    expect(text()).toContain(`Save $50.00 - $100.00${NB}CAD (50% off)`);
    expect(text()).toContain(`Save up to $100.00${NB}CAD (50% off)`);
  });

  it("does not badge a sold-out discount on an in-stock product (#114)", () => {
    const sold = { ...variant(50, 100), available: false };
    render(<ProductCard product={product("CAD", [sold, variant(20)])} />);
    expect(text()).not.toContain("Save");
  });

  it("shows a bare $ with no code when the currency is unknown", () => {
    render(<ProductCard product={product(undefined, [variant(20, 30)])} />);
    expect(text()).toContain("Save $10.00 (33% off)");
    expect(text()).toContain("$20.00");
    expect(text()).not.toMatch(/\b[A-Z]{3}\b/);
  });
});

describe("ProductCard tags (#113)", () => {
  it("renders repeated tags and skips non-string ones instead of crashing", () => {
    const p = { ...product("USD", [variant(5)]), tags: ["new", "new", null, 7, "sale"] };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ProductCard product={p} />)).not.toThrow();
    expect(text()).toContain("sale");
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    spy.mockRestore();
  });
});

describe("ProductCard content", () => {
  const rich = (overrides = {}) => ({
    ...product("USD", [variant(5)]),
    url: "https://shop.example.com/products/tee",
    images: [{ url: "https://example.com/tee.jpg" }],
    ...overrides,
  });

  it("shows the title, image and a View link that opens the product in a new tab", () => {
    render(<ProductCard product={rich()} />);
    expect(screen.getByRole("heading", { name: "Tee" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Tee" }).getAttribute("src")).toBe("https://example.com/tee.jpg");
    const link = screen.getByRole("link", { name: /View/ });
    expect(link.getAttribute("href")).toBe("https://shop.example.com/products/tee");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows no image and no View link when the product has neither", () => {
    render(<ProductCard product={rich({ images: [], url: null })} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("badges a product with no variant in stock as Out of Stock, and an in-stock one not", () => {
    const sold = { ...variant(5), available: false };
    render(<ProductCard product={rich({ variants: [sold] })} />);
    expect(text()).toContain("Out of Stock");
    cleanup();
    render(<ProductCard product={rich()} />);
    expect(text()).not.toContain("Out of Stock");
  });

  it("shows no stock label on a product with no variants, but keeps Price unavailable (#125)", () => {
    render(<ProductCard product={rich({ variants: [] })} />);
    expect(text()).not.toContain("Out of Stock");
    expect(text()).not.toContain("In Stock");
    expect(text()).toContain("Price unavailable");
  });

  it("keeps the sale badge on a sold-out product that was discounted", () => {
    const sold = { ...variant(20, 30), available: false };
    render(<ProductCard product={rich({ variants: [sold] })} />);
    expect(text()).toContain("Out of Stock");
    expect(text()).toContain("Save $10.00");
  });

  it("says the price is unavailable when no variant has a number for it", () => {
    render(<ProductCard product={rich({ variants: [variant(NaN)] })} />);
    expect(text()).toContain("Price unavailable");
    cleanup();
    render(<ProductCard product={rich({ variants: [] })} />);
    expect(text()).toContain("Price unavailable");
  });

  it("lists variant titles up to a length and counts the rest", () => {
    const titles = ["Small", "Medium", "Large", "X-Large", "XX-Large", "XXX-Large"];
    render(<ProductCard product={rich({ variants: titles.map((t, i) => ({ ...variant(5 + i), title: t })) })} />);
    expect(text()).toContain("Small, Medium, Large, X-Large");
    expect(text()).toContain("+2 more");
  });

  it("truncates a single variant title that is too long to fit", () => {
    render(<ProductCard product={rich({ variants: [{ ...variant(5), title: "A".repeat(60) }] })} />);
    expect(text()).toContain(`${"A".repeat(32)}...`);
  });

  it("shows the vendors, joined", () => {
    render(<ProductCard product={rich({ vendors: ["Acme", "Beta Co"] })} />);
    expect(text()).toContain("Acme, Beta Co");
  });

  it("shows at most three short tags, shortens a long one, and counts the rest", () => {
    const tags = ["one", "two", "x".repeat(18), "four", "five"];
    render(<ProductCard product={rich({ tags })} />);
    expect(text()).toContain("one");
    expect(text()).toContain("two");
    expect(text()).toContain(`${"x".repeat(15)}…`);
    expect(text()).not.toContain("four");
    expect(text()).toContain("+2");
  });

  it("falls back to the first tags when none is short", () => {
    const tags = ["y".repeat(25), "z".repeat(25)];
    render(<ProductCard product={rich({ tags })} />);
    expect(text()).toContain(`${"y".repeat(15)}…`);
    expect(text()).toContain(`${"z".repeat(15)}…`);
  });
});
