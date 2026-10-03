import { describe, it, expect } from "vitest";
import { currencySymbol, formatMoney } from "./currency";

describe("currencySymbol", () => {
  it("falls back to $ when the platform gives no currency", () => {
    expect(currencySymbol()).toBe("$");
    expect(currencySymbol(undefined)).toBe("$");
    expect(currencySymbol("")).toBe("$");
  });

  it("returns the narrow symbol for a known currency", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("\u20ac");
    expect(currencySymbol("GBP")).toBe("\u00a3");
    expect(currencySymbol("NZD")).toBe("$");
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

  it("uses the narrow symbol, so dollar currencies read the same as the label", () => {
    expect(formatMoney(20, "NZD")).toBe("$20.00");
    expect(formatMoney(20, "AUD")).toBe("$20.00");
    expect(formatMoney(20, "CAD")).toBe("$20.00");
  });

  it("agrees with currencySymbol for every currency", () => {
    for (const code of ["USD", "NZD", "AUD", "CAD", "EUR", "GBP", "JPY", "CHF", "SEK"]) {
      expect(formatMoney(5, code)).toContain(currencySymbol(code));
    }
  });

  it("falls back to code and amount for an invalid currency", () => {
    expect(formatMoney(5, "nope!")).toBe("nope! 5.00");
  });
});
