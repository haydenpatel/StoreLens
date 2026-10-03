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
      { price: "10.00", compare_at_price: null },
      { price: "10.00", compare_at_price: "10.00" },
      { price: "10.00", compare_at_price: "5.00" },
    ]);
    expect(result.hasDiscount).toBe(false);
  });

  it("computes amount and percent for a single discounted variant", () => {
    const result = getDiscountData([{ price: "60.00", compare_at_price: "80.00" }]);
    expect(result.hasDiscount).toBe(true);
    expect(result.discountAmount).toBe(20);
    expect(result.discountPercent).toBe(25);
  });

  it("uses the variant with the largest absolute discount", () => {
    const result = getDiscountData([
      { price: "9.00", compare_at_price: "10.00" }, // 1 off, 10%
      { price: "50.00", compare_at_price: "80.00" }, // 30 off, 37.5%
      { price: "70.00", compare_at_price: "90.00" }, // 20 off, 22.2%
    ]);
    expect(result.discountAmount).toBe(30);
    expect(result.discountPercent).toBe(37.5);
  });
});
