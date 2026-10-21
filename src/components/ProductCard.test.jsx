// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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

  it("shows one percentage when only the saving differs (#114)", () => {
    render(<ProductCard product={product("CAD", [variant(50, 100), variant(100, 200)])} />);
    expect(text()).toContain(`Save $50.00 - $100.00${NB}CAD (50% off)`);
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
