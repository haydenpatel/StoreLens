import { afterEach, describe, expect, it, vi } from "vitest";
import { compareText, formatCount, formatNumber, formatPercent, getLocale, setLocale } from "./locale";

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en-US");
});

describe("getLocale", () => {
  // setLocale() pins a tag; these tests reset it to read navigator instead.
  const detect = (navigatorStub) => {
    vi.stubGlobal("navigator", navigatorStub);
    setLocale(undefined);
    return getLocale();
  };

  it("reads the first of navigator.languages, canonicalised", () => {
    expect(detect({ languages: ["de-de", "en"], language: "en" })).toBe("de-DE");
  });

  it("falls back to navigator.language", () => {
    expect(detect({ language: "tr-TR" })).toBe("tr-TR");
  });

  it("falls back to en-US for a malformed tag, without throwing", () => {
    expect(detect({ languages: ["not a locale!!"] })).toBe("en-US");
    setLocale("not a locale!!");
    expect(getLocale()).toBe("en-US");
  });

  it("falls back to en-US without a navigator or any language", () => {
    expect(detect(undefined)).toBe("en-US");
    expect(detect({})).toBe("en-US");
  });
});

describe("formatNumber and formatCount", () => {
  it.each([
    ["en-US", "1,234"],
    ["de-DE", "1.234"],
    ["fr-FR", "1 234"],
    ["tr-TR", "1.234"],
  ])("groups a count by %s", (tag, expected) => {
    setLocale(tag);
    expect(formatCount(1234)).toBe(expected);
  });

  it("uses Latin digits in every locale", () => {
    for (const tag of ["ar-EG", "fa-IR", "hi-IN-u-nu-deva", "bn-BD"]) {
      setLocale(tag);
      expect(formatCount(1234567)).toMatch(/^[\d.,\u202f\u00a0 ']+$/);
      expect(formatNumber(12.5, { minimumFractionDigits: 2 })).toMatch(/^[\d.,\u202f\u00a0 ']+$/);
    }
  });

  it("follows a changed locale (the cache is keyed by it)", () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe("1,234.50");
    setLocale("de-DE");
    expect(formatNumber(1234.5, { minimumFractionDigits: 2 })).toBe("1.234,50");
  });
});

describe("formatPercent", () => {
  it.each([
    ["en-US", 33, undefined, "33%"],
    ["de-DE", 33, undefined, "33 %"],
    ["tr-TR", 33, undefined, "%33"],
    ["en-US", 10, 33, "10-33%"],
    ["tr-TR", 10, 33, "%10-33"],
    ["de-DE", 10, 33, "10-33 %"],
    ["ja-JP", 10, 33, "10-33%"],
  ])("%s: %s to %s reads %j", (tag, low, high, expected) => {
    setLocale(tag);
    expect(formatPercent(low, high)).toBe(expected);
  });

  it("chooses decimals after rounding (#126)", () => {
    expect(formatPercent(0.96)).toBe("1%");
    expect(formatPercent(0.96, 1.2)).toBe("1%");
    expect(formatPercent(0.4)).toBe("0.4%");
    expect(formatPercent(0.4, 33)).toBe("0.4-33%");
    expect(formatPercent(33.4)).toBe("33%");
    setLocale("de-DE");
    expect(formatPercent(0.4)).toBe("0,4 %");
    expect(formatPercent(0.96, 1.2)).toBe("1 %");
  });

  it("uses Latin digits and one sign in ar-EG", () => {
    setLocale("ar-EG");
    const text = formatPercent(10, 33);
    expect(text).toMatch(/10-33/);
    expect(text.match(/%/g)).toHaveLength(1);
  });
});

describe("compareText", () => {
  const sorted = (list) => [...list].sort(compareText);

  it("puts capitalised names among the lowercase ones, not before them", () => {
    expect(sorted(["Zebra", "apple", "Apple"])).toEqual(["apple", "Apple", "Zebra"]);
  });

  it("orders numbers inside text numerically", () => {
    expect(sorted(["Item 10", "Item 2", "Item 1"])).toEqual(["Item 1", "Item 2", "Item 10"]);
  });

  it("puts accented letters beside their base letter", () => {
    expect(sorted(["Zoe", "Eve", "Éva", "Ada"])).toEqual(["Ada", "Éva", "Eve", "Zoe"]);
  });

  it("follows the locale's alphabet", () => {
    expect(sorted(["z", "ä"])).toEqual(["ä", "z"]);
    setLocale("sv-SE");
    expect(sorted(["z", "ä"])).toEqual(["z", "ä"]);
  });
});
