// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
