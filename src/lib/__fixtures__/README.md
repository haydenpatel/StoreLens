# Test fixtures

Everything here is **synthetic**: invented products, brands and prices, with
`example.com` URLs. They reproduce the *shape* of Shopify's public JSON feeds
so tests can run offline.

Do not add data copied from real stores (titles, descriptions, images, brand
names). That content belongs to the merchants.

## Helpers

- `adapter-contract.js`: `expectAdapterShape(adapter)` and `expectNeutralProduct(product, capabilities)`. Every platform adapter's tests call these against its own adapter and the products it returns, so adapters can't drift from the neutral model in `platforms/types.js` or from each other. Adding a capability means adding it to `CAPABILITY_KEYS` there.
- `fake-shopify-fetch.js`: a `fetch` stand-in serving synthetic Shopify-shaped stores, for page-level tests.
- `test-helpers.js`: `memoryStorage` and `jsonResponse`.
