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
 * @property {string} [currency]          ISO 4217 code when the platform provides one.
 * @property {boolean} available
 * @property {string} [createdAt]          ISO 8601.
 * @property {NeutralVariant[]} variants
 * @property {NeutralOption[]} options
 */

/**
 * What a platform can supply. The UI hides filters it can't populate.
 * @typedef {Object} AdapterCapabilities
 * @property {boolean} vendors
 * @property {boolean} categories
 * @property {boolean} tags
 * @property {boolean} variantOptions
 * @property {boolean} variantStock
 * @property {boolean} description
 * @property {boolean} collectionDiscovery
 */

/**
 * @typedef {Object} FetchCollectionResult
 * @property {NeutralProduct[]} products
 * @property {Error|null} pageError   A page failed part-way; products holds what was loaded.
 * @property {boolean} truncated      The platform's paging limit was hit; more products exist.
 */

/**
 * @typedef {Object} PlatformAdapter
 * @property {string} id
 * @property {string} name                                    Shown in user-facing copy.
 * @property {AdapterCapabilities} capabilities
 * @property {(url: URL) => boolean} matchesUrl               Cheap, URL-only check used by detection.
 * @property {(url: URL) => {origin: string, collection: string|null}} parseUrl
 * @property {(origin: string, collection: string) => string} collectionUrl
 * @property {(origin: string, signal?: AbortSignal, opts?: {forceRefresh?: boolean}) =>
 *   Promise<{collections: {handle: string, title: string, products_count: number|null}[], allProductsHandle: string|null}>} listCollections
 * @property {(raw: any, origin: string) => NeutralProduct} normalize   Maps one raw platform product to the neutral shape.
 * @property {(collectionUrl: string, opts: {signal?: AbortSignal}) => Promise<FetchCollectionResult>} fetchCollection
 *   Throws on an invalid URL, and rethrows an abort. Everything else is reported in the result.
 */

export {};
