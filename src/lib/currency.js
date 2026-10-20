// Prices come from platforms that may or may not say what currency they use.
// Without a currency the UI keeps showing "$", as it always has.

const FALLBACK_SYMBOL = "$";

// One formatter for both uses so the symbol in a label ("Discount $") and the symbol
// in an amount ("$20.00") always agree. Both use the full symbol, not the narrow
// one, so currencies that share "$" stay apart (CA$, A$, NZ$) and a CAD price is
// never read as USD; USD itself stays "$", and a currency with no distinct
// symbol shows its code (SGD, SEK).
function currencyFormat(currency, decimals) {
  const digits = decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
    ...digits,
  });
}

export function currencySymbol(currency) {
  if (!currency) return FALLBACK_SYMBOL;
  try {
    const parts = currencyFormat(currency).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    // Not a valid ISO 4217 code.
    return currency;
  }
}

// `decimals` overrides the usual two (the price-range label shows whole units).
export function formatMoney(amount, currency, { decimals } = {}) {
  if (!currency) return `${FALLBACK_SYMBOL}${amount.toFixed(decimals ?? 2)}`;
  try {
    return currencyFormat(currency, decimals).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(decimals ?? 2)}`;
  }
}
