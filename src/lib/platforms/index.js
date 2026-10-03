import { shopifyAdapter } from "./shopify";

// Builds the lookup helpers over an ordered adapter list. Detection order is
// list order, and the last adapter is the fallback for any URL no earlier one
// claims, so a fallback platform (Shopify) must come last and every platform
// added later goes in front of it.
export function createRegistry(adapters) {
  const fallback = adapters[adapters.length - 1];
  return {
    defaultAdapter: fallback,
    detectAdapter: (url) => adapters.find((adapter) => adapter.matchesUrl(url)) ?? fallback,
    getAdapterById: (id) => adapters.find((adapter) => adapter.id === id) ?? null,
    // For user-facing copy, e.g. "Shopify" today, "Shopify, Fourthwall or Big
    // Cartel" once more platforms are registered.
    supportedPlatformNames: () => {
      const names = adapters.map((adapter) => adapter.name);
      if (names.length <= 1) return names.join("");
      return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
    },
  };
}

export const { defaultAdapter, detectAdapter, getAdapterById, supportedPlatformNames } =
  createRegistry([shopifyAdapter]);
