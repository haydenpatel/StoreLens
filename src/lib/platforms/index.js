import { shopifyAdapter } from "./shopify";

// Builds the lookup helpers over an ordered adapter list. Detection order is
// list order, and the last adapter is the fallback for any URL no earlier one
// claims, so a fallback platform (Shopify) must come last and every platform
// added later goes in front of it.
export function createRegistry(adapters) {
  const fallback = adapters[adapters.length - 1];
  const detectAdapter = (url) => adapters.find((adapter) => adapter.matchesUrl(url)) ?? fallback;
  return {
    defaultAdapter: fallback,
    detectAdapter,
    // Works out which adapter handles a pasted URL. Async so that detection can
    // one day ask the network (a custom domain can't be told from its URL alone);
    // today it is URL-only and settles straight away. The page awaits it and
    // aborts it when a newer input arrives, so an implementation must honour
    // `signal` and reject with an AbortError once it aborts.
    //
    // Where a network check plugs in: when the URL-only match settles on the
    // fallback (no other adapter recognised the URL), ask the adapters that can
    // detect over the network, in list order, passing `signal` to every request,
    // and keep the fallback only if none of them claims the store. The cheap URL
    // match stays first so the common case is still instant.
    resolveAdapter: async (url, { signal } = {}) => {
      signal?.throwIfAborted();
      return detectAdapter(url);
    },
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

export const { defaultAdapter, detectAdapter, resolveAdapter, getAdapterById, supportedPlatformNames } =
  createRegistry([shopifyAdapter]);
