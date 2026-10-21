import { describe, it, expect } from "vitest";
import { getDiscountData } from "./utils";

describe("getDiscountData", () => {
  it("reports no discount for empty or missing variants", () => {
    const none = { hasDiscount: false, discountAmount: 0, discountPercent: 0 };
    expect(getDiscountData([])).toEqual(none);
    expect(getDiscountData()).toEqual(none);
  });

  it("ignores variants without a higher compare_at_price", () => {
    const result = getDiscountData([
      { price: 10, compareAtPrice: null },
      { price: 10, compareAtPrice: 10 },
      { price: 10, compareAtPrice: 5 },
    ]);
    expect(result.hasDiscount).toBe(false);
  });

  it("computes amount and percent for a single discounted variant", () => {
    const result = getDiscountData([{ price: 60, compareAtPrice: 80 }]);
    expect(result.hasDiscount).toBe(true);
    expect(result.discountAmount).toBe(20);
    expect(result.discountPercent).toBe(25);
  });

  it("uses the variant with the largest absolute discount", () => {
    const result = getDiscountData([
      { price: 9, compareAtPrice: 10 }, // 1 off, 10%
      { price: 50, compareAtPrice: 80 }, // 30 off, 37.5%
      { price: 70, compareAtPrice: 90 }, // 20 off, 22.2%
    ]);
    expect(result.discountAmount).toBe(30);
    expect(result.discountPercent).toBe(37.5);
  });

  it("ignores sold-out variants when another variant is in stock (#114)", () => {
    const result = getDiscountData([
      { price: 50, compareAtPrice: 100, available: false },
      { price: 95, compareAtPrice: 100, available: true },
    ]);
    expect(result.discountAmount).toBe(5);
    expect(result.discountPercent).toBe(5);
    const none = getDiscountData([
      { price: 50, compareAtPrice: 100, available: false },
      { price: 20, compareAtPrice: null, available: true },
    ]);
    expect(none.hasDiscount).toBe(false);
  });

  it("keeps the discount of a product that is entirely sold out", () => {
    const result = getDiscountData([{ price: 50, compareAtPrice: 100, available: false }]);
    expect(result.hasDiscount).toBe(true);
    expect(result.discountAmount).toBe(50);
  });

  it("reports the best percentage separately from the biggest saving", () => {
    const result = getDiscountData([
      { price: 50, compareAtPrice: 100, available: true },
      { price: 300, compareAtPrice: 400, available: true },
    ]);
    expect(result.discountAmount).toBe(100);
    expect(result.discountPercent).toBe(50);
    expect(result.minAmount).toBe(50);
    expect(result.minPercent).toBe(25);
    expect(result.bestPercentAmount).toBe(50);
  });
});
