// A fetch() stand-in that serves synthetic Big Cartel-shaped shops, like
// fake-shopify-fetch.js does for Shopify. Invented shops and products only.
import { jsonResponse } from "./test-helpers";

export const FEED_HOST = "api.bigcartel.com";

// shops: { "shop-name": rawProduct[] }, keyed by the shop's subdomain.
//   - A shop that isn't listed answers 404, as the real feed does (and with CORS
//     headers, so the status is readable).
//   - `locked` names shops that answer 403.
// override(url) and `honorAbort` work as in fakeShopifyFetch.
export function fakeBigCartelFetch(shops, override, { honorAbort = false, locked = [] } = {}) {
  const calls = [];
  const respond = async (input) => {
    const url = new URL(String(input));
    calls.push(url);

    const custom = override?.(url);
    if (custom !== undefined) return custom;

    // Only the feed host is readable from a browser; a shop's own host sends no CORS headers.
    if (url.host !== FEED_HOST) throw new TypeError("Failed to fetch");
    const match = url.pathname.match(/^\/([^/]+)\/products\.json$/);
    if (!match) return jsonResponse({}, { ok: false, status: 404 });
    const [, shop] = match;
    if (locked.includes(shop)) return jsonResponse({ reason: "Store is locked" }, { ok: false, status: 403 });
    if (!shops[shop]) return jsonResponse({}, { ok: false, status: 404 });
    return jsonResponse(shops[shop]);
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
