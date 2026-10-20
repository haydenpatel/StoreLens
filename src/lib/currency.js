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

// Digit layout (decimal point and grouping) is fixed, not taken from the
// browser: the UI text is English-only and the result is the same everywhere.
// Symbol, number and code are placed by the rules above, not by Intl.
const NUMBER_LOCALE = "en-US";

// Splits an amount into its symbol, digits and code. Throws for an invalid code.
function moneyParts(amount, currency, decimals) {
  const digits = decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  const parts = new Intl.NumberFormat(NUMBER_LOCALE, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    ...digits,
  }).formatToParts(amount);
  const symbol = parts.find((part) => part.type === "currency")?.value ?? currency;
  const number = parts.filter((part) => part.type !== "currency" && part.type !== "literal").map((part) => part.value).join("");
  // A letter symbol ("kr", "CHF") is set apart from the digits.
  const prefix = /\p{L}$/u.test(symbol) ? `${symbol}\u00a0` : symbol;
  return { prefix, number, code: symbol === currency ? "" : currency };
}

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
    const one = (n) => `${FALLBACK_SYMBOL}${n.toFixed(decimals ?? 2)}`;
    return min === max ? one(min) : `${one(min)} - ${one(max)}`;
  }
  try {
    const low = moneyParts(min, currency, decimals);
    if (min === max) return withCode(`${low.prefix}${low.number}`, low.code);
    const high = moneyParts(max, currency, decimals);
    return withCode(`${low.prefix}${low.number} - ${high.prefix}${high.number}`, high.code);
  } catch {
    // Not a valid ISO 4217 code.
    const one = (n) => n.toFixed(decimals ?? 2);
    return min === max ? `${currency} ${one(min)}` : `${currency} ${one(min)} - ${one(max)}`;
  }
}
