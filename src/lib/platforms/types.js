// Platform-neutral shapes shared by every platform adapter and the UI.
// JSDoc only; nothing here runs.

/**
 * @typedef {Object} NeutralVariant
 * @property {string|number} id
 * @property {string} title
 * @property {number} price
 * @property {number|null} compareAtPrice  Original price when on sale, else null.
 * @property {boolean} available
 * @property {string[]} options            Option values by position, e.g. ["Large", "Black"].
 */

/**
 * @typedef {Object} NeutralOption
 * @property {string} name                 e.g. "Size".
 * @property {string[]} values
 */

/**
 * @typedef {Object} NeutralProduct
 * @property {string|number} id
 * @property {string} handle
 * @property {string} title
 * @property {string|null} url             Absolute link to the product page.
 * @property {{url: string}[]} images
 * @property {string} [description]        HTML or text, searched by the UI.
 * @property {string[]} vendors
 * @property {string[]} categories
 * @property {string[]} tags
 * @property {string} [currency]          ISO 4217 code when the platform provides one; the UI falls back to "$".
 * @property {boolean} available
 * @property {string} [createdAt]          ISO 8601.
 * @property {NeutralVariant[]} variants
 * @property {NeutralOption[]} options    Named option groups; variants[].options[i] belongs to options[i].
 */

/**
 * What a platform can supply. The UI hides filters it can't populate.
 * The keys here are mirrored by `CAPABILITY_KEYS` in `__fixtures__/adapter-contract.js`,
 * which the adapter tests check against; keep the two in step by hand.
 * `variantStock` means availability is reported at all (product-level is
 * enough, copied onto each variant); when false the in-stock filter is hidden
 * and ignored, and the adapter should report every product as available.
 * @typedef {Object} AdapterCapabilities
 * @property {boolean} vendors
 * @property {boolean} categories
 * @property {boolean} tags
 * @property {boolean} variantOptions
 * @property {boolean} variantStock
 * @property {boolean} collectionDiscovery
 */

/**
 * @typedef {Object} FetchCollectionResult
 * @property {NeutralProduct[]} products
 * @property {Error|null} pageError   A page failed; products holds what loaded before it (nothing if the first page failed).
 * @property {boolean} truncated      A paging limit was hit; more products exist.
 * @property {{level: "info"|"warning", message: string}[]} [notices]
 *   Things the user should know about this particular load that aren't failures
 *   (e.g. that variant option names were guessed). Shown alongside the products
 *   and cleared on the next load.
 */

/**
 * @typedef {Object} PlatformAdapter
 * @property {string} id
 * @property {string} name                                    Shown in user-facing copy.
 * @property {AdapterCapabilities} capabilities
 * @property {{vendors: string, categories: string}} labels   Filter section titles, e.g. "Vendor"/"Artists".
 * @property {string} [supportNote]   A sentence about stores of this platform that can't be read (e.g. only some addresses work), added to
 *   the "couldn't reach this store" message, since such a store looks like any unreachable one. Phrased as a limit ("Sorry, ..."), not as a task.
 * @property {(url: URL) => boolean} matchesUrl               Cheap, URL-only check used by detection. Detection that needs a network
 *   request (a custom domain that can't be told from its URL) doesn't go here: it plugs into the registry's
 *   `resolveAdapter` (see platforms/index.js), after this check.
 * @property {(url: URL, opts: {signal?: AbortSignal}) => Promise<boolean>} [detect]
 *   Optional network check, for a platform whose stores can't be recognised from the URL alone (a custom
 *   domain). Called by the registry's `resolveAdapter` when no adapter claimed the URL: it must make at
 *   most one cheap request, never retry, give up quickly, resolve false (not throw) when the store isn't
 *   this platform, and rethrow an abort.
 * @property {(url: URL) => {origin: string, collection: string|null}} parseUrl
 *   `origin` may carry a locale prefix (e.g. https://shop.example.com/en-nz) when the platform has one.
 * @property {(origin: string, collection: string) => string} collectionUrl
 * @property {string} [defaultCollection]   Collection to auto-load for a bare store when the platform has no collection listing.
 * @property {string} [collectionsNote]   For a platform with no collection listing: shown, disabled, at the end of the collection dropdown
 *   (which offers only "All Products" and the collection on screen) to say why other collections aren't listed.
 * @property {(origin: string, signal?: AbortSignal, opts?: {forceRefresh?: boolean}) =>
 *   Promise<{collections: {handle: string, title: string, products_count: number|null}[], allProductsHandle: string|null, origin?: string}>} [listCollections]
 *   Optional: platforms without a listing omit it and set defaultCollection.
 *   `origin`, when present, is the origin that actually worked (e.g. a locale prefix turned out not to be one); the caller switches to it.
 * @property {(collectionUrl: string, opts: {signal?: AbortSignal, onProgress?: (p: {loaded: number}) => void}) => Promise<FetchCollectionResult>} fetchCollection
 *   Throws on an invalid URL, and rethrows an abort. Everything else is reported in the result.
 *   `pageError` is a StoreError (see lib/errors.js) when the failure is one the UI can explain.
 *   `onProgress` is called with the running product count after each page.
 */

export {};
