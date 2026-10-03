import { shopifyAdapter } from "./shopify";

// Detection order. The last adapter is the fallback for any URL no earlier
// adapter claims, so keep Shopify last: every platform added later claims its
// own URLs first.
const ADAPTERS = [shopifyAdapter];

export function detectAdapter(url) {
  return ADAPTERS.find((adapter) => adapter.matchesUrl(url)) ?? ADAPTERS[ADAPTERS.length - 1];
}

export function getAdapterById(id) {
  return ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

// For user-facing copy, e.g. "Shopify" today, "Shopify, Fourthwall or Big
// Cartel" once more platforms are registered.
export function supportedPlatformNames() {
  const names = ADAPTERS.map((adapter) => adapter.name);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export { shopifyAdapter };
