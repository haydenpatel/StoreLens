// A fetch() stand-in that serves synthetic Shopify-shaped stores, so page-level
// tests can drive the real adapter offline. Everything here is invented
// (example.com hosts, made-up products). See README.md.
import { jsonResponse } from "./test-helpers";

const notFound = () => jsonResponse({}, { ok: false, status: 404 });

// stores: { "shop.example.com": { collections: { handle: rawProduct[] }, listing?: false } }
//   - `listing: false` makes /collections.json 404 (a store that hides it).
//   - `listCollections: false` leaves the collections out of the listing, so
//     only probing can find them.
//   - An unknown host fails the way an unreadable one does: fetch throws.
// override(url: URL) may return a Response (or a promise of one) to replace the
// default answer for a request, or undefined to fall through. Tests use it to
// hold a response back, or to fail one page.
export function fakeShopifyFetch(stores, override) {
  const calls = [];
  const fetchMock = async (input) => {
    const url = new URL(String(input));
    calls.push(url);

    const custom = override?.(url);
    if (custom !== undefined) return custom;

    const store = stores[url.host];
    if (!store) throw new TypeError("Failed to fetch");

    if (url.pathname === "/products.json") {
      const first = Object.values(store.collections)[0]?.[0];
      return jsonResponse({ products: first ? [first] : [] });
    }

    if (url.pathname === "/collections.json") {
      if (store.listing === false) return notFound();
      const listed =
        store.listCollections === false
          ? []
          : Object.entries(store.collections).map(([handle, products]) => ({
              handle,
              title: handle.replace(/-/g, " "),
              products_count: products.length,
            }));
      return jsonResponse({ collections: listed });
    }

    const match = url.pathname.match(/^\/collections\/([^/]+)\/products\.json$/);
    if (match) {
      const products = store.collections[match[1]];
      if (!products) return notFound();
      const limit = Number(url.searchParams.get("limit") || 250);
      const page = Number(url.searchParams.get("page") || 1);
      return jsonResponse({ products: products.slice((page - 1) * limit, page * limit) });
    }

    return notFound();
  };
  fetchMock.calls = calls;
  return fetchMock;
}
