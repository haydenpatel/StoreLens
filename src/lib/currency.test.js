import { describe, it, expect } from "vitest";
import { currencyLabel, formatMoney, formatMoneyRange } from "./currency";

const NB = " ";

describe("formatMoney", () => {
  it("formats with a bare $ and two decimals when the currency is unknown, as before", () => {
    expect(formatMoney(20)).toBe("$20.00");
    expect(formatMoney(12.5, undefined)).toBe("$12.50");
    expect(formatMoney(12.5, "")).toBe("$12.50");
  });

  it.each([
    ["USD", `$1,234.50${NB}USD`],
    ["CAD", `$1,234.50${NB}CAD`],
    ["AUD", `$1,234.50${NB}AUD`],
    ["NZD", `$1,234.50${NB}NZD`],
    ["GBP", `£1,234.50${NB}GBP`],
    ["EUR", `€1,234.50${NB}EUR`],
    ["JPY", `¥1,235${NB}JPY`],
    ["SGD", `$1,234.50${NB}SGD`],
    ["SEK", `kr${NB}1,234.50${NB}SEK`],
    ["CHF", `CHF${NB}1,234.50`],
    ["MXN", `$1,234.50${NB}MXN`],
    ["BRL", `R$1,234.50${NB}BRL`],
    ["INR", `₹1,234.50${NB}INR`],
  ])("formats %s as <symbol><number> <CODE>", (code, expected) => {
    expect(formatMoney(1234.5, code)).toBe(expected);
  });

  it("never formats the dollar currencies the same as USD or each other", () => {
    const codes = ["USD", "CAD", "AUD", "NZD", "HKD", "MXN"];
    const out = codes.map((code) => formatMoney(20, code));
    expect(new Set(out).size).toBe(codes.length);
  });

  it("keeps the currency's own decimals, with zero for JPY", () => {
    expect(formatMoney(13, "JPY")).toBe(`¥13${NB}JPY`);
  });

  it("can show whole units, as the price-range label does", () => {
    expect(formatMoney(10, undefined, { decimals: 0 })).toBe("$10");
    expect(formatMoney(10, "USD", { decimals: 0 })).toBe(`$10${NB}USD`);
    expect(formatMoney(1234, "EUR", { decimals: 0 })).toBe(`€1,234${NB}EUR`);
    expect(formatMoney(10, "CHF", { decimals: 0 })).toBe(`CHF${NB}10`);
  });

  it("uses en-US digits whatever the reader's locale", () => {
    expect(formatMoney(1234567.891, "EUR")).toBe(`€1,234,567.89${NB}EUR`);
  });

  it("falls back to code and amount for an invalid currency", () => {
    expect(formatMoney(5, "nope!")).toBe("nope! 5.00");
  });
});

describe("formatMoneyRange", () => {
  it("shows the code once, at the end", () => {
    expect(formatMoneyRange(5, 730, "CAD", { decimals: 0 })).toBe(`$5 - $730${NB}CAD`);
    expect(formatMoneyRange(19.99, 29.99, "GBP")).toBe(`£19.99 - £29.99${NB}GBP`);
  });

  it("is a single value when min equals max", () => {
    expect(formatMoneyRange(5, 5, "CAD")).toBe(`$5.00${NB}CAD`);
    expect(formatMoneyRange(5, 5)).toBe("$5.00");
  });

  it("is a single value when the amounts format the same (#124)", () => {
    expect(formatMoneyRange(9.999999999999998, 10)).toBe("$10.00");
    expect(formatMoneyRange(9.999999999999998, 10, "CAD")).toBe(`$10.00${NB}CAD`);
    expect(formatMoneyRange(10, 10.01)).toBe("$10.00 - $10.01");
  });

  it("keeps a bare $ range when the currency is unknown", () => {
    expect(formatMoneyRange(5, 10)).toBe("$5.00 - $10.00");
    expect(formatMoneyRange(5, 10, undefined, { decimals: 0 })).toBe("$5 - $10");
  });

  it("repeats the symbol but adds no code for a currency whose symbol is its code", () => {
    expect(formatMoneyRange(5, 10, "CHF", { decimals: 0 })).toBe(`CHF${NB}5 - CHF${NB}10`);
  });

  it("falls back to code and amounts for an invalid currency", () => {
    expect(formatMoneyRange(5, 10, "nope!")).toBe("nope! 5.00 - 10.00");
  });
});

describe("currencyLabel", () => {
  it("is a bare $ when the currency is unknown", () => {
    expect(currencyLabel()).toBe("$");
    expect(currencyLabel("")).toBe("$");
  });

  it("shows the code for a known currency, as the amounts end with it", () => {
    expect(currencyLabel("CAD")).toBe("(CAD)");
    expect(formatMoney(5, "CAD")).toContain("CAD");
    expect(formatMoney(5, "USD")).toContain(currencyLabel("USD").slice(1, -1));
  });
});
