import { describe, it, expect } from "vitest";
import { currencySymbol, formatMoney } from "./currency";

describe("currencySymbol", () => {
  it("falls back to $ when the platform gives no currency", () => {
    expect(currencySymbol()).toBe("$");
    expect(currencySymbol(undefined)).toBe("$");
    expect(currencySymbol("")).toBe("$");
  });

  it("returns the symbol for a known currency", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("\u20ac");
    expect(currencySymbol("GBP")).toBe("\u00a3");
    expect(currencySymbol("NZD")).toBe("NZ$");
    expect(currencySymbol("CAD")).toBe("CA$");
  });

  it("returns the code itself for something that isn't a valid currency", () => {
    expect(currencySymbol("nope!")).toBe("nope!");
  });
});

describe("formatMoney", () => {
  it("formats with a $ and two decimals when there is no currency, as before", () => {
    expect(formatMoney(20)).toBe("$20.00");
    expect(formatMoney(12.5, undefined)).toBe("$12.50");
  });

  it("formats with the currency's own symbol and separators", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(20, "EUR")).toBe("\u20ac20.00");
    expect(formatMoney(20, "JPY")).toBe("\u00a520");
  });

  it.each([
    ["USD", "$1,234.50"],
    ["CAD", "CA$1,234.50"],
    ["AUD", "A$1,234.50"],
    ["NZD", "NZ$1,234.50"],
    ["GBP", "\u00a31,234.50"],
    ["EUR", "\u20ac1,234.50"],
    ["JPY", "\u00a51,235"],
    ["SGD", "SGD\u00a01,234.50"],
    ["HKD", "HK$1,234.50"],
    ["SEK", "SEK\u00a01,234.50"],
    ["CHF", "CHF\u00a01,234.50"],
    ["MXN", "MX$1,234.50"],
    ["BRL", "R$1,234.50"],
    ["INR", "\u20b91,234.50"],
  ])("formats %s as %s", (code, expected) => {
    expect(formatMoney(1234.5, code)).toBe(expected);
  });

  it("never formats a dollar currency the same as USD", () => {
    for (const code of ["CAD", "AUD", "NZD", "HKD", "MXN"]) {
      expect(formatMoney(20, code)).not.toBe(formatMoney(20, "USD"));
      expect(currencySymbol(code)).not.toBe(currencySymbol("USD"));
    }
  });

  it("agrees with currencySymbol for every currency", () => {
    for (const code of ["USD", "NZD", "AUD", "CAD", "EUR", "GBP", "JPY", "CHF", "SEK"]) {
      expect(formatMoney(5, code)).toContain(currencySymbol(code));
    }
  });

  it("can show whole units, as the price-range label does", () => {
    expect(formatMoney(10, undefined, { decimals: 0 })).toBe("$10");
    expect(formatMoney(10, "USD", { decimals: 0 })).toBe("$10");
    expect(formatMoney(1234, "EUR", { decimals: 0 })).toBe("\u20ac1,234");
  });

  it("separates a code-style symbol from the amount, like the card amounts", () => {
    // CHF has no distinct symbol, so the code is shown.
    expect(currencySymbol("CHF")).toBe("CHF");
    expect(formatMoney(10, "CHF", { decimals: 0 })).toBe("CHF\u00a010");
    expect(formatMoney(10, "CHF")).toBe("CHF\u00a010.00");
  });

  it("falls back to code and amount for an invalid currency", () => {
    expect(formatMoney(5, "nope!")).toBe("nope! 5.00");
  });
});
