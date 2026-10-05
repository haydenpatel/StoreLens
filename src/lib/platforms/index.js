import { shopifyAdapter } from "./shopify";
import { fourthwallAdapter } from "./fourthwall";
import { clearPlatformCache, loadPlatformCache, savePlatformCache } from "@/lib/store";

const platformCache = { load: loadPlatformCache, save: savePlatformCache, clear: clearPlatformCache };

// Builds the lookup helpers over an ordered adapter list. Detection order is
// list order, and the last adapter is the fallback for any URL no earlier one
// claims, so a fallback platform (Shopify) must come last and every platform
// added later goes in front of it. `cache` remembers which platform an origin is
// on (see lib/store.js); tests pass their own.
export function createRegistry(adapters, { cache = platformCache } = {}) {
  const fallback = adapters[adapters.length - 1];
  const detectAdapter = (url) => adapters.find((adapter) => adapter.matchesUrl(url)) ?? fallback;
  const getAdapterById = (id) => adapters.find((adapter) => adapter.id === id) ?? null;
  return {
    defaultAdapter: fallback,
    detectAdapter,
    // Works out which adapter handles a pasted URL. Async because a store that
    // can't be recognised from its URL (a custom domain) is identified over the
    // network. The page awaits it and aborts it when a newer input arrives, so
    // it honours `signal` and rejects with an AbortError once it aborts.
    //
    // In order: an adapter that recognises the URL on its own; the platform
    // remembered for this origin; each adapter's own `detect` network check (one
    // cheap request each); and last the fallback. Only a positive detection is
    // remembered here (see rememberAdapter for the rest), never the fallback by
    // default, so a flaky request can't pin a store to the wrong platform.
    resolveAdapter: async (url, { signal } = {}) => {
      signal?.throwIfAborted();
      const byUrl = detectAdapter(url);
      if (byUrl !== fallback) return byUrl;

      const cached = getAdapterById(cache.load(url.origin));
      if (cached) return cached;

      for (const adapter of adapters) {
        if (adapter === fallback || !adapter.detect) continue;
        if (await adapter.detect(url, { signal })) {
          cache.save(url.origin, adapter.id);
          return adapter;
        }
      }
      return fallback;
    },
    // A load worked, so the store really is on this platform: remember it, so the
    // next visit skips the network check (this is how a Shopify store gets
    // cached, since detection only ever confirms the others).
    rememberAdapter: (url, adapter) => cache.save(url.origin, adapter.id),
    // A load failed, so what was remembered may be out of date (a store that
    // changed platform): forget it and detect afresh next time.
    forgetAdapter: (url) => cache.clear(url.origin),
    getAdapterById,
    // For user-facing copy, e.g. "Shopify or Fourthwall". The fallback (the
    // original platform) comes first, then the rest in list order.
    supportedPlatformNames: () => {
      const names = [fallback, ...adapters.slice(0, -1)].map((adapter) => adapter.name);
      if (names.length <= 1) return names.join("");
      return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
    },
  };
}

export const {
  defaultAdapter,
  detectAdapter,
  resolveAdapter,
  rememberAdapter,
  forgetAdapter,
  getAdapterById,
  supportedPlatformNames,
} = createRegistry([fourthwallAdapter, shopifyAdapter]);
