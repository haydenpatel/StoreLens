import { loadCollectionsCache, saveCollectionsCache } from "@/lib/store";
import { StoreError, diagnoseFailure, isAbort, kindFromStatus, probeUrl } from "@/lib/errors";
import { fetchPages, fetchWithRetry } from "./requests";

const PLATFORM_ID = "shopify";

// Shopify's legacy /products.json pagination tops out at 1000 pages of up
// to 250 items (250,000 products). Beyond that — or if a page request
// fails partway through a very large collection — keep whatever was
// already fetched instead of discarding it all on one bad request.
export const MAX_PRODUCT_PAGES = 1000;
const PAGE_SIZE = 250;

const CURRENCY_CODE = /^[A-Z]{3}$/;

// How long to wait for /meta.json. It is an optional extra and the products
// load alongside it, so a slow answer mustn't hold the store up.
const META_TIMEOUT_MS = 5000;
// How much longer the products wait for it once they have all arrived.
const META_GRACE_MS = 750;

// The store's base currency, from /meta.json (keyless and readable from the
// browser). Any failure, or a slow answer, just means it is unknown and prices
// show with the default "$".
async function readCurrency(origin) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), META_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}/meta.json`, { signal: timeout.signal });
    if (!response.ok) return undefined;
    const code = (await response.json())?.currency;
    return typeof code === "string" && CURRENCY_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function trimTrailingEmpty(values) {
  const out = [...values];
  while (out.length > 0 && (out[out.length - 1] === null || out[out.length - 1] === undefined)) {
    out.pop();
  }
  return out;
}

// Maps one raw /products.json entry onto the neutral product shape.
// Shopify returns tags as an array from /products.json, but some endpoints
// return a comma-separated string.
function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === "string") {
    return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

// Shopify sends "0.00" (not null) when there is no compare-at price.
function normalizeComparePrice(value) {
  const compare = parseFloat(value);
  return compare > 0 ? compare : null;
}

// A product with no real options still has one option named "Title" whose only
// value is "Default Title". It isn't something to filter by.
function isPlaceholderOptions(options) {
  return (
    options.length === 1 &&
    options[0].name === "Title" &&
    options[0].values?.length === 1 &&
    options[0].values[0] === "Default Title"
  );
}

const asObjects = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item)) : [];

// Maps one raw /products.json entry onto the neutral product shape.
export function normalizeShopifyProduct(raw, origin) {
  // One malformed entry (a null option, variant or image) is skipped, not allowed
  // to fail the whole page.
  const rawOptions = asObjects(raw.options);
  const placeholder = isPlaceholderOptions(rawOptions);
  const variants = asObjects(raw.variants).map((v) => ({
    id: v.id,
    // The placeholder's lone variant is called "Default Title"; with no real
    // options it has nothing worth showing as a variant name.
    title: placeholder ? "" : v.title,
    price: parseFloat(v.price),
    compareAtPrice: normalizeComparePrice(v.compare_at_price),
    // A feed that stops sending the field must not read as everything sold out,
    // which would empty the default in-stock view: only an explicit false is.
    available: v.available !== false,
    options: placeholder ? [] : trimTrailingEmpty([v.option1, v.option2, v.option3]),
  }))
    // An unparseable price is "unavailable", not NaN: the variant is dropped.
    .filter((variant) => Number.isFinite(variant.price));

  let url = null;
  if (raw.handle && origin) {
    // Links are always https on the store's hostname, as they were before
    // this became an adapter.
    try {
      url = `https://${new URL(origin).hostname}/products/${raw.handle}`;
    } catch {
      url = null;
    }
  }

  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    url,
    images: asObjects(raw.images).map((image) => ({ url: image.src })),
    description: raw.body_html,
    vendors: raw.vendor ? [raw.vendor] : [],
    categories: raw.product_type ? [raw.product_type] : [],
    tags: normalizeTags(raw.tags),
    available: variants.some((v) => v.available),
    createdAt: raw.created_at,
    variants,
    options: placeholder ? [] : rawOptions.map((o) => ({ name: o.name, values: o.values || [] })),
  };
}

export function getCollectionJsonUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    if (pathname.includes("/collections/")) {
      const baseUrl = `${urlObj.protocol}//${urlObj.host}${pathname}`;
      return baseUrl.endsWith("/")
        ? `${baseUrl}products.json`
        : `${baseUrl}/products.json`;
    }

    throw new Error("Invalid collection URL");
  } catch {
    throw new Error("Please enter a valid Shopify collection URL");
  }
}

async function fetchCollection(collectionUrl, { signal, maxPages = MAX_PRODUCT_PAGES, onProgress } = {}) {
  const jsonUrl = getCollectionJsonUrl(collectionUrl);
  const origin = new URL(collectionUrl).origin;
  // Every Shopify store answers this, so it tells "this collection doesn't
  // exist" apart from "this store can't be read" when the first page fails.
  const probe = () => probeUrl(`${origin}/products.json?limit=1`, signal);
  // meta.json reports the store's base currency even on a Markets locale path,
  // whose feed carries converted prices, so the currency is only read (and
  // applied) on the plain origin. A locale path keeps the default "$".
  const isLocalePath = shopifyAdapter.parseUrl(new URL(collectionUrl)).origin !== origin;
  let currencyRequest = null;

  const fetchPage = async (page) => {
    // Only the first page is worth a probe: if it loaded, the store is readable.
    // And a later page that is "not found" isn't a missing collection (page 1
    // proved it exists): the store just stopped returning products.
    const diagnose = async (details) => {
      const err = await diagnoseFailure({ ...details, probe: page === 1 ? probe : undefined });
      return page > 1 && err.kind === "not-found" ? new StoreError("empty", { status: err.status, cause: err }) : err;
    };
    let response;
    try {
      const request = fetchWithRetry(`${jsonUrl}?page=${page}&limit=${PAGE_SIZE}`, { signal });
      // Read alongside the first page, not before it: the products don't wait on it.
      if (page === 1 && !isLocalePath && !currencyRequest) currencyRequest = readCurrency(origin);
      response = await request;
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      throw await diagnose({ cause: err });
    }
    if (!response.ok) throw await diagnose({ status: response.status });

    let data;
    try {
      data = await response.json();
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      // A body that isn't JSON is a web page, not a feed; a read that fails
      // part-way is the connection.
      throw err instanceof SyntaxError ? new StoreError("unsupported-platform", { cause: err }) : await diagnose({ cause: err });
    }
    if (!Array.isArray(data?.products)) throw new StoreError("unsupported-platform");
    return {
      items: asObjects(data.products).map((raw) => normalizeShopifyProduct(raw, origin)),
      done: data.products.length < PAGE_SIZE,
    };
  };

  // Pages are fetched one at a time: a collection's length is only known once
  // a short page comes back, and most are a page or two.
  const { items, pageError, truncated } = await fetchPages({
    fetchPage,
    concurrency: 1,
    maxPages,
    signal,
    onProgress,
  });
  if (currencyRequest) {
    let timer;
    const grace = new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), META_GRACE_MS);
    });
    const currency = await Promise.race([currencyRequest, grace]);
    clearTimeout(timer);
    if (currency) for (const item of items) item.currency = currency;
  }
  return { products: items, pageError, truncated };
}

async function fetchCollectionsPage(origin, page, signal) {
  let response;
  try {
    response = await fetchWithRetry(`${origin}/collections.json?limit=250&page=${page}`, { signal });
  } catch (err) {
    if (isAbort(err, signal)) throw err;
    throw new StoreError("blocked-or-offline", { cause: err });
  }
  if (!response.ok) {
    console.error(`Collection discovery failed for ${origin}: ${response.status} ${response.statusText}`);
    // A 404 here isn't a missing collection: the store has no listing at all,
    // which is what a store on another platform looks like.
    const kind = kindFromListingStatus(response.status);
    throw new StoreError(kind, { status: response.status });
  }
  let data;
  try {
    data = await response.json();
  } catch (err) {
    if (isAbort(err, signal)) throw err;
    throw new StoreError(err instanceof SyntaxError ? "unsupported-platform" : "blocked-or-offline", { cause: err });
  }
  return Array.isArray(data?.collections) ? data.collections : [];
}

// Shopify auto-generates an "all products" collection for every store, but
// themes frequently exclude it from the Online Store sales channel, so it
// never shows up in /collections.json even though its endpoint still works.
// This same list doubles as the dropdown's priority sort order, so a probed
// or listed match is always treated consistently as "the" all-products
// collection rather than inferred from list position.
const ALL_PRODUCTS_HANDLES = ["all", "all-products", "all-1", "everything", "shop-all"];

// What a failed listing response means: a 404 here isn't a missing collection,
// the store has no listing at all, which is what a store on another platform
// looks like.
function kindFromListingStatus(status) {
  return status === 404 || status === 410 ? "unsupported-platform" : kindFromStatus(status);
}

// A status that says nothing about what the store has: a rate limit, a request
// timeout or a server error. Any other answer (404, 403, 400, ...) is the
// store's own, however odd, and counts as definitive.
const isTransientStatus = (status) => status === 429 || status === 408 || status >= 500;

// A failure that says nothing about what the store has: a transient status or a
// dropped connection. Trade-off: a request that fails at the network level (a
// /collections.json blocked without CORS headers, say) can't be told apart from
// being offline, so it counts as transient: such a store's list stays uncached
// and offers the retry button rather than risk pinning an incomplete list.
const isTransient = (err) => err?.kind === "blocked-or-offline" || isTransientStatus(err?.status);

// Returns { found, inconclusive }: `inconclusive` means a candidate failed
// transiently, so "nothing found" may not be the store's real answer.
async function probeAllProductsCollection(origin, existingHandles, signal) {
  let inconclusive = false;
  for (const handle of ALL_PRODUCTS_HANDLES) {
    if (existingHandles.has(handle)) return { found: null, inconclusive };
    try {
      const response = await fetch(
        `${origin}/collections/${handle}/products.json?limit=1`,
        { signal }
      );
      if (!response.ok) {
        if (isTransientStatus(response.status)) inconclusive = true;
        continue;
      }
      const data = await response.json();
      if (Array.isArray(data?.products) && data.products.length > 0) {
        return { found: { handle, title: "All Products", products_count: null }, inconclusive };
      }
    } catch (err) {
      // An abort means the caller cancelled this discovery (e.g. the user
      // switched stores) — propagate it rather than treating it as "this
      // candidate failed", so the aborted discovery can't save a partial
      // result to the cache.
      if (err?.name === "AbortError") throw err;
      // A body that isn't JSON is a page, not a feed: the store's own answer.
      // A dropped connection or a body cut short says nothing about this handle.
      if (!(err instanceof SyntaxError)) inconclusive = true;
    }
  }
  return { found: null, inconclusive };
}

async function discoverCollections(origin, signal, { forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : loadCollectionsCache(PLATFORM_ID, origin);
  if (cached) {
    return cached;
  }

  // /collections.json is a "nice to have" listing that some themes block or
  // omit collections from entirely. Don't let it failing prevent us from
  // still finding the store's all-products collection by direct probing.
  let allCollections = [];
  let listingError = null;
  // Whether anything below failed transiently. A result built from a failed
  // request is shown but not cached, so it can't pin an incomplete list for
  // hours; the caller flags it as `partial` so the user can try again.
  let partial = false;
  try {
    const seenPages = new Set();
    const maxPages = 20;
    let page = 1;
    let keepGoing = true;

    while (keepGoing && page <= maxPages) {
      const collections = await fetchCollectionsPage(origin, page, signal);
      const signature = JSON.stringify(collections);
      if (collections.length === 0 || seenPages.has(signature)) {
        break;
      }
      seenPages.add(signature);
      allCollections.push(...collections);
      if (collections.length < 250) {
        keepGoing = false;
      } else {
        page += 1;
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    listingError = err;
    // Keep the pages that did load: a partial list beats none.
    if (isTransient(err)) partial = true;
  }

  const mapped = allCollections
    .filter((c) => typeof c === "object" && c !== null && c.products_count > 0)
    .map((c) => ({
      handle: c.handle,
      title: typeof c.title === "string" && c.title.trim() ? c.title : c.handle,
      products_count: c.products_count,
    }));

  const { found: probed, inconclusive } = await probeAllProductsCollection(
    origin,
    new Set(mapped.map((c) => c.handle)),
    signal
  );
  if (inconclusive) partial = true;
  const withProbe = probed ? [probed, ...mapped] : mapped;

  if (withProbe.length === 0 && listingError) {
    throw listingError;
  }

  const filtered = withProbe.sort((a, b) => {
    const aIndex = ALL_PRODUCTS_HANDLES.indexOf(a.handle);
    const bIndex = ALL_PRODUCTS_HANDLES.indexOf(b.handle);

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return String(a.title ?? "").localeCompare(String(b.title ?? ""), undefined, { sensitivity: "base" });
  });

  // Only treat a collection as "the" all-products collection when it's a
  // known handle (probed or listed) — never infer it from list position,
  // since an arbitrary alphabetically-first collection is not a safe guess.
  const allProductsMatch = filtered.find((c) => ALL_PRODUCTS_HANDLES.includes(c.handle));
  const allProductsHandle = allProductsMatch ? allProductsMatch.handle : null;

  if (partial) return { collections: filtered, allProductsHandle, partial: true };
  saveCollectionsCache(PLATFORM_ID, origin, filtered, allProductsHandle);
  return { collections: filtered, allProductsHandle };
}

const hasUsableCollections = (result) => result.collections.length > 0 || Boolean(result.allProductsHandle);

// parseUrl treats a short first path segment (/en-nz) as a Markets locale, but
// it could just as well be an ordinary page (/uk). When the locale-bearing
// origin definitively has nothing (it answered, and the answer was "no"), try
// the plain origin; if that works the result carries `origin` so the caller
// switches to it. A transient failure (rate limit, server error, dropped
// connection) proves nothing about the locale, so it is never a reason to
// switch: the user keeps their market and sees the error or a partial result.
async function listCollections(origin, signal, options = {}) {
  const plainOrigin = new URL(origin).origin;
  if (plainOrigin === origin) return discoverCollections(origin, signal, options);

  let primary;
  let primaryError;
  try {
    primary = await discoverCollections(origin, signal, options);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    primaryError = err;
  }
  if (primary && hasUsableCollections(primary)) return primary;
  if (primaryError && isTransient(primaryError)) throw primaryError;
  if (primary?.partial) return primary;

  try {
    const fallback = await discoverCollections(plainOrigin, signal, options);
    if (hasUsableCollections(fallback)) return { ...fallback, origin: plainOrigin };
    // Nothing usable and not conclusive: stay in the user's market.
    if (fallback.partial) return { collections: [], allProductsHandle: null, partial: true };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    // The locale said "no", but the plain origin couldn't be checked.
    if (isTransient(err)) throw err;
  }
  if (primaryError) throw primaryError;
  return primary;
}

/** @type {import("./types").PlatformAdapter} */
export const shopifyAdapter = {
  id: PLATFORM_ID,
  name: "Shopify",
  // What the filter sections are called for this platform.
  labels: { vendors: "Vendor", categories: "Product Type" },
  capabilities: {
    vendors: true,
    categories: true,
    tags: true,
    variantOptions: true,
    variantStock: true,
    collectionDiscovery: true,
  },
  // Shopify is the fallback: until another platform claims a URL it is
  // treated as Shopify, which is how StoreLens behaved before adapters.
  matchesUrl: () => true,
  // Shopify Markets puts an optional locale in front of the collection path
  // (/en-nz/collections/all). It is kept as part of the returned origin, so
  // the market's pricing and listings carry through discovery, loading and
  // the app route. A locale-only root (/en-nz) is also a market, so a store
  // box showing "shop.com/en-nz" reloads the same market; it is limited to a
  // two-letter language so ordinary short pages such as /faq are not mistaken
  // for one.
  parseUrl(url) {
    const match = url.pathname.match(/^(\/[a-z]{2,3}(?:-[a-z0-9]{2,8})?)?\/collections\/([^/]+)/i);
    if (match) {
      return { origin: `${url.origin}${match[1] ?? ""}`, collection: match[2] };
    }
    const root = url.pathname.match(/^(\/[a-z]{2}(?:-[a-z0-9]{2,8})?)\/?$/i);
    return { origin: `${url.origin}${root?.[1] ?? ""}`, collection: null };
  },
  collectionUrl: (origin, collection) => `${origin}/collections/${collection}`,
  listCollections,
  fetchCollection,
};
