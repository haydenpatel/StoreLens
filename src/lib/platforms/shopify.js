import { loadCollectionsCache, saveCollectionsCache } from "@/lib/store";

const PLATFORM_ID = "shopify";

// Shopify's legacy /products.json pagination tops out at 1000 pages of up
// to 250 items (250,000 products). Beyond that — or if a page request
// fails partway through a very large collection — keep whatever was
// already fetched instead of discarding it all on one bad request.
export const MAX_PRODUCT_PAGES = 1000;
const PAGE_SIZE = 250;

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

// Maps one raw /products.json entry onto the neutral product shape.
export function normalizeShopifyProduct(raw, origin) {
  const rawOptions = raw.options || [];
  const placeholder = isPlaceholderOptions(rawOptions);
  const variants = (raw.variants || []).map((v) => ({
    id: v.id,
    title: v.title,
    price: parseFloat(v.price),
    compareAtPrice: normalizeComparePrice(v.compare_at_price),
    available: Boolean(v.available),
    options: placeholder ? [] : trimTrailingEmpty([v.option1, v.option2, v.option3]),
  }));

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
    images: (raw.images || []).map((image) => ({ url: image.src })),
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

async function fetchCollection(collectionUrl, { signal, maxPages = MAX_PRODUCT_PAGES } = {}) {
  const jsonUrl = getCollectionJsonUrl(collectionUrl);
  const origin = new URL(collectionUrl).origin;

  const products = [];
  let page = 1;
  let hasMore = true;
  let pageError = null;

  while (hasMore && page <= maxPages) {
    try {
      const response = await fetch(`${jsonUrl}?page=${page}&limit=${PAGE_SIZE}`, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch page ${page} (status ${response.status})`);
      }
      const data = await response.json();
      if (data.products && data.products.length > 0) {
        // Push in place rather than spreading into a new array each page —
        // for a collection near the 1000-page cap, re-copying the whole
        // accumulated array on every iteration is O(n²).
        for (const raw of data.products) {
          products.push(normalizeShopifyProduct(raw, origin));
        }
        page++;
        hasMore = data.products.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    } catch (err) {
      // Superseded: the caller owns what happens next.
      if (signal?.aborted) throw err;
      pageError = err;
      hasMore = false;
    }
  }

  return { products, pageError, truncated: page > maxPages && hasMore };
}

async function fetchCollectionsPage(origin, page, signal) {
  const response = await fetch(
    `${origin}/collections.json?limit=250&page=${page}`,
    { signal }
  );
  if (!response.ok) {
    const errorMessage = `Failed to fetch collections (status ${response.status})`;
    console.error(`Collection discovery failed for ${origin}: ${response.status} ${response.statusText}`);
    throw new Error(errorMessage);
  }
  const data = await response.json();
  return Array.isArray(data?.collections) ? data.collections : [];
}

// Shopify auto-generates an "all products" collection for every store, but
// themes frequently exclude it from the Online Store sales channel, so it
// never shows up in /collections.json even though its endpoint still works.
// This same list doubles as the dropdown's priority sort order, so a probed
// or listed match is always treated consistently as "the" all-products
// collection rather than inferred from list position.
const ALL_PRODUCTS_HANDLES = ["all", "all-products", "all-1", "everything", "shop-all"];

async function probeAllProductsCollection(origin, existingHandles, signal) {
  for (const handle of ALL_PRODUCTS_HANDLES) {
    if (existingHandles.has(handle)) return null;
    try {
      const response = await fetch(
        `${origin}/collections/${handle}/products.json?limit=1`,
        { signal }
      );
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.products) && data.products.length > 0) {
        return { handle, title: "All Products", products_count: null };
      }
    } catch (err) {
      // An abort means the caller cancelled this discovery (e.g. the user
      // switched stores) — propagate it rather than treating it as "this
      // candidate failed", so the aborted discovery can't save a partial
      // result to the cache.
      if (err?.name === "AbortError") throw err;
      /* try the next candidate handle */
    }
  }
  return null;
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
    allCollections = [];
  }

  const mapped = allCollections
    .filter((c) => c.products_count > 0)
    .map((c) => ({
      handle: c.handle,
      title: c.title,
      products_count: c.products_count,
    }));

  const probed = await probeAllProductsCollection(
    origin,
    new Set(mapped.map((c) => c.handle)),
    signal
  );
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

    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  // Only treat a collection as "the" all-products collection when it's a
  // known handle (probed or listed) — never infer it from list position,
  // since an arbitrary alphabetically-first collection is not a safe guess.
  const allProductsMatch = filtered.find((c) => ALL_PRODUCTS_HANDLES.includes(c.handle));
  const allProductsHandle = allProductsMatch ? allProductsMatch.handle : null;

  saveCollectionsCache(PLATFORM_ID, origin, filtered, allProductsHandle);
  return { collections: filtered, allProductsHandle };
}

const hasUsableCollections = (result) => result.collections.length > 0 || Boolean(result.allProductsHandle);

// parseUrl treats a short first path segment (/en-nz) as a Markets locale, but
// it could just as well be an ordinary page (/uk). When nothing can be found
// under the locale-bearing origin, try the plain origin; if that works the
// result carries `origin` so the caller switches to it.
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

  try {
    const fallback = await discoverCollections(plainOrigin, signal, options);
    if (hasUsableCollections(fallback)) return { ...fallback, origin: plainOrigin };
  } catch (err) {
    if (err?.name === "AbortError") throw err;
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
    description: true,
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
  normalize: normalizeShopifyProduct,
};
