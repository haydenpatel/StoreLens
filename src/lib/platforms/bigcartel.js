// Big Cartel: a public, keyless, CORS-readable product feed at
// https://api.bigcartel.com/{shop}/products.json, one unpaged array of every
// product (`page`, `offset` and `per_page` are ignored). It is a legacy,
// undocumented feed, so parsing is tolerant. Categories are only a field on each
// product, so the collection list is derived from the fetched products. See
// platforms/types.js for the shape this maps onto.
import { StoreError, diagnoseFailure, isAbort } from "@/lib/errors";
import { fetchWithRetry } from "./requests";

const PLATFORM_ID = "bigcartel";

const FEED_HOST = "https://api.bigcartel.com";
const SHOP_HOST = /^([a-z0-9][a-z0-9-]*)\.bigcartel\.com$/i;
// Big Cartel's own sites, not shops.
const NOT_SHOPS = new Set(["www", "api", "admin"]);

// The storefront has no "all products" category: its product listing is /products.
// That page stands in for the pseudo-collection a bare domain opens.
const ALL_PRODUCTS_HANDLE = "all";

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// Collections and products are read from the same feed, so a load that follows
// discovery (or the reverse) reuses one request. Short-lived, so a refresh sees
// changes.
const FEED_TTL_MS = 30_000;
const feeds = new Map();

export const clearFeedCache = () => feeds.clear();

const shopOf = (url) => {
  const match = url.hostname.match(SHOP_HOST);
  return match && !NOT_SHOPS.has(match[1].toLowerCase()) ? match[1].toLowerCase() : null;
};

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === "string" ? value.trim() : "");

// Reads a shop's feed. Never given a signal: the request is shared between
// callers (see loadFeed), so it isn't theirs to abort.
async function readFeed(shop) {
  let response;
  try {
    response = await fetchWithRetry(`${FEED_HOST}/${shop}/products.json`);
  } catch (err) {
    throw await diagnoseFailure({ cause: err });
  }
  // Unlike other platforms' errors, these carry CORS headers, so the status is
  // readable and says what is wrong with no probe. The feed is the whole shop,
  // so a 404 means the shop itself is missing or closed, not a collection.
  if (response.status === 404 || response.status === 410) throw new StoreError("store-not-found", { status: response.status });
  if (!response.ok) throw await diagnoseFailure({ status: response.status });

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw err instanceof SyntaxError ? new StoreError("unsupported-platform", { cause: err }) : await diagnoseFailure({ cause: err });
  }
  if (!Array.isArray(data)) throw new StoreError("unsupported-platform");
  return data.filter(isObject);
}

// The shop's raw products, from the shared copy when it is fresh. The request
// itself isn't tied to one caller's signal (another may be waiting on it), so a
// caller that aborts just stops waiting.
function loadFeed(shop, { signal, forceRefresh = false } = {}) {
  signal?.throwIfAborted();
  const cached = feeds.get(shop);
  let entry = cached && !forceRefresh && Date.now() - cached.at < FEED_TTL_MS ? cached : null;
  if (!entry) {
    // Drop shops last read long ago, so a long session doesn't hold every feed it has opened.
    for (const [key, old] of feeds) if (Date.now() - old.at >= FEED_TTL_MS) feeds.delete(key);
    const promise = readFeed(shop);
    entry = { at: Date.now(), promise };
    feeds.set(shop, entry);
    promise.catch(() => {
      if (feeds.get(shop) === entry) feeds.delete(shop);
    });
  }
  if (!signal) return entry.promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const toIsoDate = (value) => (typeof value === "string" && ISO_8601.test(value) && !Number.isNaN(Date.parse(value)) ? value : undefined);

// Maps one raw feed entry onto the neutral product shape.
export function normalizeBigCartelProduct(raw, origin) {
  const groups = asArray(raw.option_groups)
    .filter(isObject)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const soldOutProduct = raw.status === "sold-out";
  const basePrice = Number(raw.default_price ?? raw.price);

  const variants = asArray(raw.options)
    .filter(isObject)
    .map((option) => {
      const values = asArray(option.option_group_values).filter(isObject);
      const valueOf = (group) => text(values.find((v) => v.option_group_id === group.id)?.name);
      const optionValues = groups.map(valueOf);
      while (optionValues.length > 0 && optionValues[optionValues.length - 1] === "") optionValues.pop();
      const price = Number(option.price ?? raw.price);
      return {
        id: option.id,
        title: groups.length ? text(option.name) : "",
        price,
        // `on_sale` is set on products that aren't discounted, so a compare-at
        // price needs both the flag and a base price above this option's.
        compareAtPrice: raw.on_sale === true && basePrice > price ? basePrice : null,
        available: option.sold_out !== true && !soldOutProduct,
        options: optionValues,
      };
    })
    .filter((variant) => Number.isFinite(variant.price));

  const images = asArray(raw.images)
    .filter(isObject)
    .map((image) => ({ url: image.secure_url ?? image.url }))
    .filter((image) => typeof image.url === "string");
  const permalink = text(raw.permalink);

  return {
    id: raw.id,
    handle: permalink,
    title: text(raw.name),
    url: permalink ? `${origin}/product/${permalink}` : null,
    images,
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    vendors: asArray(raw.artists).map((artist) => text(artist?.name)).filter(Boolean),
    categories: asArray(raw.categories).map((category) => text(category?.name)).filter(Boolean),
    tags: [],
    available: variants.some((v) => v.available),
    ...(toIsoDate(raw.created_at) ? { createdAt: raw.created_at } : {}),
    variants,
    options: groups.map((group) => ({
      name: text(group.name),
      values: asArray(group.values)
        .map((value) => text(value?.name))
        .filter(Boolean),
    })),
  };
}

// Pages of a shop: its listing (/products) is "all"; a category is
// /category/{permalink}. Anything else (the root, a product page) is a bare store.
function parseUrl(url) {
  const origin = url.origin;
  const category = url.pathname.match(/^\/category\/([^/]+)\/?$/i);
  if (category) {
    try {
      return { origin, collection: decodeURIComponent(category[1]) };
    } catch {
      return { origin, collection: category[1] };
    }
  }
  if (/^\/products(\.json)?\/?$/i.test(url.pathname)) return { origin, collection: ALL_PRODUCTS_HANDLE };
  return { origin, collection: null };
}

const inCategory = (raw, permalink) =>
  asArray(raw.categories).some((category) => text(category?.permalink).toLowerCase() === permalink.toLowerCase());

async function fetchCollection(collectionUrl, { signal, onProgress } = {}) {
  const url = new URL(collectionUrl);
  const { origin, collection } = parseUrl(url);
  const shop = shopOf(url);
  if (!shop || !collection) throw new Error("Please enter a valid Big Cartel shop or category URL");

  let feed;
  try {
    feed = await loadFeed(shop, { signal });
  } catch (err) {
    if (isAbort(err, signal)) throw err;
    return { products: [], pageError: err, truncated: false };
  }

  const matching = collection === ALL_PRODUCTS_HANDLE ? feed : feed.filter((raw) => inCategory(raw, collection));
  // The shop answered but has no such category: tell the user it's the
  // collection that's missing, not that the shop returned nothing.
  const pageError = matching.length === 0 && feed.length > 0 ? new StoreError("not-found") : null;
  const products = matching.map((raw) => normalizeBigCartelProduct(raw, origin));
  onProgress?.({ loaded: products.length });
  return { products, pageError, truncated: false };
}

// The categories in use, with how many products each holds, preceded by the
// "all" pseudo-collection so a bare domain auto-loads.
async function listCollections(origin, signal, { forceRefresh = false } = {}) {
  const shop = shopOf(new URL(origin));
  if (!shop) throw new StoreError("unsupported-platform");
  const feed = await loadFeed(shop, { signal, forceRefresh });

  const categories = new Map();
  for (const raw of feed) {
    const seen = new Set();
    for (const category of asArray(raw.categories)) {
      const handle = text(category?.permalink);
      // A category whose permalink is "all" would share a handle with the
      // pseudo-collection, and loading it means loading everything anyway.
      if (!handle || handle.toLowerCase() === ALL_PRODUCTS_HANDLE || seen.has(handle.toLowerCase())) continue;
      seen.add(handle.toLowerCase());
      const entry = categories.get(handle.toLowerCase()) ?? { handle, title: text(category.name) || handle, products_count: 0 };
      entry.products_count += 1;
      categories.set(handle.toLowerCase(), entry);
    }
  }
  const sorted = [...categories.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return {
    collections: [{ handle: ALL_PRODUCTS_HANDLE, title: "All Products", products_count: feed.length }, ...sorted],
    allProductsHandle: ALL_PRODUCTS_HANDLE,
  };
}

/** @type {import("./types").PlatformAdapter} */
export const bigcartelAdapter = {
  id: PLATFORM_ID,
  name: "Big Cartel",
  labels: { vendors: "Artists", categories: "Category" },
  capabilities: {
    vendors: true,
    categories: true,
    tags: false,
    variantOptions: true,
    variantStock: true,
    collectionDiscovery: true,
  },
  supportNote: "If this is a Big Cartel shop, sorry: StoreLens can only read ones at a shopname.bigcartel.com address, not on their own domain.",
  // A shop is recognised from its *.bigcartel.com address alone. A custom domain
  // can't be mapped to a shop name from the URL, so it isn't supported.
  matchesUrl: (url) => shopOf(url) !== null,
  parseUrl,
  collectionUrl: (origin, collection) =>
    collection === ALL_PRODUCTS_HANDLE ? `${origin}/products` : `${origin}/category/${encodeURIComponent(collection)}`,
  listCollections,
  fetchCollection,
};
