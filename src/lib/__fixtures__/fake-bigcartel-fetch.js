// A fetch() stand-in that serves synthetic Big Cartel-shaped shops, like
// fake-shopify-fetch.js does for Shopify. Invented shops and products only.
import { jsonResponse } from "./test-helpers";

export const FEED_HOST = "api.bigcartel.com";

// shops: { "shop-name": rawProduct[] }, keyed by the shop's subdomain.
//   - A shop that isn't listed answers 404, as the real feed does (and with CORS
//     headers, so the status is readable).
//   - `locked` names shops that answer 403.
//   - store.json answers for every listed shop: USD, with a product count equal to
//     the number of products. `stores` overrides it per shop: an object is merged
//     over those defaults (`{ currency: "EUR", products_count: 99 }`), and null
//     makes store.json answer 404.
// override(url) and `honorAbort` work as in fakeShopifyFetch.
export function fakeBigCartelFetch(shops, override, { honorAbort = false, locked = [], stores = {} } = {}) {
  const calls = [];
  const respond = async (input) => {
    const url = new URL(String(input));
    calls.push(url);

    const custom = override?.(url);
    if (custom !== undefined) return custom;

    // Only the feed host is readable from a browser; a shop's own host sends no CORS headers.
    if (url.host !== FEED_HOST) throw new TypeError("Failed to fetch");
    const match = url.pathname.match(/^\/([^/]+)\/(products|store)\.json$/);
    if (!match) return jsonResponse({}, { ok: false, status: 404 });
    const [, shop, document] = match;
    if (locked.includes(shop)) return jsonResponse({ reason: "Store is locked" }, { ok: false, status: 403 });
    if (!shops[shop]) return jsonResponse({}, { ok: false, status: 404 });
    if (document === "products") return jsonResponse(shops[shop]);

    if (stores[shop] === null) return jsonResponse({}, { ok: false, status: 404 });
    const { currency = "USD", ...rest } = stores[shop] ?? {};
    return jsonResponse({
      id: 1,
      subdomain: shop,
      products_count: shops[shop].length,
      currency: { id: 1, sign: "$", name: currency, code: currency, locale: "en" },
      ...rest,
    });
  };

  const fetchMock = (input, init) => {
    const signal = init?.signal;
    if (!honorAbort || !signal) return respond(input);
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      respond(input)
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  };
  fetchMock.calls = calls;
  return fetchMock;
}
