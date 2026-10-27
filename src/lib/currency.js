import { formatNumber, numberFormat, numberText } from "@/lib/locale";

// Prices come from platforms that may or may not say what currency they use.
//
// When the currency is known, every amount is laid out the same way:
// <symbol><number> <CODE> ("$12.50 CAD", "£12.50 GBP", "¥13 JPY"), so a price
// never depends on the reader's locale or a shared "$" to say which currency it
// is. USD is not special-cased. The one structural exception: a currency whose
// symbol is its own code (CHF) shows it once ("CHF 12.50").
// When the currency is unknown the UI keeps showing a bare "$", as it always
// has, so a missing code means "currency unknown".

const FALLBACK_SYMBOL = "$";

// The symbol is fixed (from en-US, so "$", "£", "kr" are the same everywhere),
// while the digits' decimal point and grouping follow the viewer's locale
// (locale.js). Symbol, number and code are placed by the rules above, not by
// Intl, so the order is the same in every locale.
const SYMBOL_LOCALE = "en-US";

// Splits an amount into its symbol, digits and code. Throws for an invalid code.
function moneyParts(amount, currency, decimals) {
  const digits = decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  const options = { style: "currency", currency, currencyDisplay: "narrowSymbol", ...digits };
  const symbol = numberFormat(options, SYMBOL_LOCALE).formatToParts(amount).find((part) => part.type === "currency")?.value ?? currency;
  const number = numberText(numberFormat(options).formatToParts(amount));
  // A letter symbol ("kr", "CHF") is set apart from the digits.
  const prefix = /\p{L}$/u.test(symbol) ? `${symbol}\u00a0` : symbol;
  return { prefix, number, code: symbol === currency ? "" : currency };
}

// An amount with no currency to say how many decimals it has.
const plainNumber = (n, decimals) =>
  formatNumber(n, { minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2 });

const withCode = (text, code) => (code ? `${text}\u00a0${code}` : text);

// What a label shows in place of an amount: "$" when the currency is unknown,
// otherwise its code in brackets ("Discount (CAD)"), as amounts end with it.
export function currencyLabel(currency) {
  return currency ? `(${currency})` : FALLBACK_SYMBOL;
}

// `decimals` overrides the usual two (the price-range label shows whole units).
export function formatMoney(amount, currency, { decimals } = {}) {
  return formatMoneyRange(amount, amount, currency, { decimals });
}

// One amount, or "min - max" with the code shown once at the end. Reusable for
// any pair of amounts (prices, savings).
export function formatMoneyRange(min, max, currency, { decimals } = {}) {
  if (!currency) {
    const one = (n) => `${FALLBACK_SYMBOL}${plainNumber(n, decimals)}`;
    return one(min) === one(max) ? one(min) : `${one(min)} - ${one(max)}`;
  }
  try {
    const low = moneyParts(min, currency, decimals);
    const high = moneyParts(max, currency, decimals);
    // Equal once formatted (e.g. 9.999999999999998 and 10): show one amount.
    if (low.number === high.number) return withCode(`${low.prefix}${low.number}`, low.code);
    return withCode(`${low.prefix}${low.number} - ${high.prefix}${high.number}`, high.code);
  } catch {
    // Not a valid ISO 4217 code.
    const one = (n) => plainNumber(n, decimals);
    return one(min) === one(max) ? `${currency} ${one(min)}` : `${currency} ${one(min)} - ${one(max)}`;
  }
}

// Whether two amounts read the same once formatted in the currency (so
// 9.999999999999998 and 10 do, and 0.001 and 0.002 in USD do).
export function sameMoney(a, b, currency, options) {
  return formatMoneyRange(a, a, currency, options) === formatMoneyRange(b, b, currency, options);
}
