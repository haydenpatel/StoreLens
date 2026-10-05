// A fetch() stand-in that serves synthetic Fourthwall-shaped shops, like
// fake-shopify-fetch.js does for Shopify. Invented hosts and products only.
import { collectionPage } from "./fourthwall";
import { jsonResponse } from "./test-helpers";

export const PAGE_SIZE = 20;

// shops: { "shop.example.com": { collections: { slug: rawProduct[] } } }
//   - An unknown host, or a collection the shop doesn't have, fails the way the
//     real feed does for a browser: fetch throws (Fourthwall's 404 carries no CORS).
//   - A locale prefix (/en-nzd) is ignored, as on the real feed.
// override(url) and `honorAbort` work as in fakeShopifyFetch.
export function fakeFourthwallFetch(shops, override, { honorAbort = false } = {}) {
  const calls = [];
  const respond = async (input) => {
    const url = new URL(String(input));
    calls.push(url);

    const custom = override?.(url);
    if (custom !== undefined) return custom;

    const shop = shops[url.host];
    if (!shop) throw new TypeError("Failed to fetch");

    const path = url.pathname.replace(/^\/[a-z]{2}-[a-z]{3}(?=\/)/i, "");
    const match = path.match(/^\/collections\/([^/]+?)(?:\/(\d+))?\.json$/);
    if (!match) throw new TypeError("Failed to fetch");
    const [, slug, pageText] = match;
    const products = shop.collections[slug];
    if (!products) throw new TypeError("Failed to fetch");

    const page = pageText === undefined ? 1 : Number(pageText);
    if (page < 1) return jsonResponse({}, { ok: false, status: 422 });
    return jsonResponse(collectionPage(products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), { page, handle: slug }));
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
