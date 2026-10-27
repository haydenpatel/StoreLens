// The viewer's locale for numbers and sorting. The UI text stays English, so
// only digit layout (separators, grouping, the percent sign's position) and
// sort order follow the viewer; currency symbols and digits do not (see
// currency.js). Digits are always Latin.
//
// Search is not locale-dependent on purpose (see foldText in filters.js): a
// shared link must match the same products for every viewer.

const FALLBACK_LOCALE = "en-US";

function detectLocale() {
  try {
    const tag = (typeof navigator === "undefined" ? undefined : navigator.languages?.[0] ?? navigator.language);
    if (!tag) return FALLBACK_LOCALE;
    const [canonical] = Intl.getCanonicalLocales(tag);
    if (!canonical || Intl.NumberFormat.supportedLocalesOf(canonical).length === 0) return FALLBACK_LOCALE;
    return canonical;
  } catch {
    // A malformed tag.
    return FALLBACK_LOCALE;
  }
}

let locale;
const numberFormats = new Map();
let collator;

export function getLocale() {
  locale ??= detectLocale();
  return locale;
}

// Tests only: replaces the locale (a malformed or unsupported tag falls back to
// en-US as in the browser) and clears the caches.
export function setLocale(tag) {
  numberFormats.clear();
  collator = undefined;
  if (tag === undefined) {
    locale = undefined;
    return;
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    locale = canonical && Intl.NumberFormat.supportedLocalesOf(canonical).length > 0 ? canonical : FALLBACK_LOCALE;
  } catch {
    locale = FALLBACK_LOCALE;
  }
}

// A cached Intl.NumberFormat for the viewer's locale (or `forLocale`), always
// with Latin digits.
export function numberFormat(options = {}, forLocale = getLocale()) {
  const key = `${forLocale}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(forLocale, { ...options, numberingSystem: "latn" });
    numberFormats.set(key, format);
  }
  return format;
}

export function formatNumber(n, options) {
  return numberFormat(options).format(n);
}

// A whole-number count with the viewer's grouping ("1.234" in de-DE).
export function formatCount(n) {
  return formatNumber(n, { maximumFractionDigits: 0 });
}

const NUMBER_PART_TYPES = new Set(["integer", "group", "decimal", "fraction", "minusSign", "plusSign"]);

// The digits of a formatted number (no symbol, no spacing).
export function numberText(parts) {
  return parts.filter((part) => NUMBER_PART_TYPES.has(part.type)).map((part) => part.value).join("");
}

// A percentage (33 means 33%) in the viewer's percent style: the sign, its
// position and spacing come from the locale ("33%", "33 %", "%33"). Given a
// second value it is a range with the sign once, at the locale's position,
// the two numbers joined by a hyphen ("10-33%", "%10-33").
// The decimals are chosen after rounding: one decimal only when the value
// rounded to one decimal is below 1, so 0.96 shows "1".
export function formatPercent(low, high = low) {
  const decimalsFor = (n) => (Math.round(n * 10) / 10 < 1 ? 1 : 0);
  const partsOf = (n) => numberFormat({
    style: "percent",
    minimumFractionDigits: decimalsFor(n),
    maximumFractionDigits: decimalsFor(n),
  }).formatToParts(n / 100);
  const highParts = partsOf(high);
  const lowText = numberText(partsOf(low));
  const highText = numberText(highParts);
  const joined = lowText === highText ? highText : `${lowText}-${highText}`;
  let placed = false;
  return highParts
    .map((part) => {
      if (!NUMBER_PART_TYPES.has(part.type)) return part.value;
      if (placed) return "";
      placed = true;
      return joined;
    })
    .join("");
}

// One collator for every title and name sort. Numeric so "Item 2" precedes
// "Item 10"; default sensitivity so accent and case variants still order
// deterministically.
export function compareText(a, b) {
  collator ??= new Intl.Collator(getLocale(), { numeric: true });
  return collator.compare(a, b);
}

// Dates: none are shown today (they only drive the "newest first" sort). If one
// is ever shown, add a cached Intl.DateTimeFormat here, keyed by locale like
// numberFormat.
