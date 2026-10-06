# Test fixtures

Everything here is **synthetic**: invented products, brands and prices, with
`example.com` URLs. They reproduce the *shape* of each platform's public feeds
(Shopify, Fourthwall and Big Cartel) so tests can run offline.

Do not add data copied from real stores (titles, descriptions, images, brand
names). That content belongs to the merchants.

## Helpers

- `adapter-contract.js`: `expectAdapterShape(adapter)` and `expectNeutralProduct(product, capabilities)`. Every platform adapter's tests call these against its own adapter and the products it returns, so adapters can't drift from the neutral model in `platforms/types.js` or from each other. Adding a capability means adding it to `CAPABILITY_KEYS` there.
- `fourthwall.js`, `fake-fourthwall-fetch.js`, `fake-stores-fetch.js`: synthetic Fourthwall-shaped products (the `{origin}/collections/{slug}/{n}.json` feed), a `fetch` stand-in serving them 20 a page (an unknown collection fails the way the real feed does for a browser: `fetch` throws), and a router that mixes Fourthwall and Shopify hosts for page tests.
- `bigcartel.js`, `fake-bigcartel-fetch.js`: synthetic Big Cartel-shaped products (the `api.bigcartel.com/{shop}/products.json` feed) and a `fetch` stand-in serving them keyed by shop name, with a `store.json` per shop (USD and a matching `products_count` unless `stores` overrides it; `null` makes it 404). An unknown shop answers 404 and `locked` shops 403, both readable as the real feed is. `fake-stores-fetch.js` routes `bigcartel` shops alongside the others.
- `fake-shopify-fetch.js`: a `fetch` stand-in serving synthetic Shopify-shaped stores, for page-level tests. `override(url)` can hold back or fail a request; `{ honorAbort: true }` makes it reject with an `AbortError` when its signal aborts (by default the signal is ignored, so a held response still arrives late).
- `test-helpers.js`: `memoryStorage` and `jsonResponse`.
