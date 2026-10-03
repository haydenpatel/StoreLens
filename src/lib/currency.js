// Prices come from platforms that may or may not say what currency they use.
// Without a currency the UI keeps showing "$", as it always has.

const FALLBACK_SYMBOL = "$";

export function currencySymbol(currency) {
  if (!currency) return FALLBACK_SYMBOL;
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    // Not a valid ISO 4217 code.
    return currency;
  }
}

export function formatMoney(amount, currency) {
  if (!currency) return `${FALLBACK_SYMBOL}${amount.toFixed(2)}`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
