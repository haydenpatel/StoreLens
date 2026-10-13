// Fourthwall: a public, keyless, CORS-readable product feed at
// {origin}/collections/{slug}/{n}.json (20 products a page; `?page=` and friends
// are ignored, only the path form pages). See platforms/types.js for the shape
// this maps onto.
import { StoreError, diagnoseFailure, isAbort, probeUrl } from "@/lib/errors";
import { fetchPages, fetchWithRetry } from "./requests";

const PLATFORM_ID = "fourthwall";

// Every Fourthwall shop has an "all" collection, so it is both the default
// collection to open and what detection and the failure probe ask about.
const DEFAULT_COLLECTION = "all";

// Pages are fetched four at a time: no rate limiting was seen up to 16 at once,
// and four is about four times faster than one by one.
const CONCURRENCY = 4;

// A cap of our own (the platform has none), well past any shop seen in testing
// (300 products is 15 pages), so a runaway listing can't fetch forever.
export const MAX_PRODUCT_PAGES = 100;

// How long detection waits before deciding a store isn't Fourthwall. It runs
// before every uncached load, so a slow host mustn't hold up a Shopify store.
const DETECT_TIMEOUT_MS = 5000;
// The pause before asking again when the first answer was inconclusive.
const DETECT_RETRY_DELAY_MS = 500;

// Resolves after `ms`, or rejects as soon as the signal aborts.
const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const LOCALE = "(\\/[a-z]{2}-[a-z]{3})?";
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const COLLECTION_PATH = new RegExp(`^${LOCALE}\\/collections\\/([^/]+?)(?:\\.json|\\/products(?:\\.json)?|\\/\\d+(?:\\.json)?)?\\/?$`, "i");
const ROOT_LOCALE_PATH = /^(\/[a-z]{2}-[a-z]{3})\/?$/i;

const SIZE_TOKEN = /^(?:[2-9]?x{0,3}[sl]|[2-9]?xs|m|one size|os|\d{1,2}(?:\.5)?)$/i;
const PLACEHOLDER_TITLES = new Set(["default", "default title", "default option"]);

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// A price in cents as a number, whether the feed sent 2000 or "2000"; NaN for
// anything else (null must not read as 0).
const toCents = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
};

// A product's link: the feed gives a path ("/products/x"), but an absolute URL
// is kept as it is. Anything else falls back to the product's handle.
function productUrl(raw, origin) {
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return `${origin}${url}`;
  return `${origin}/products/${raw.handle}`;
}

const looksLikeSize = (value) => value.split("/").every((part) => SIZE_TOKEN.test(part.trim()));

// "2026-09-28 18:59:56 UTC" -> ISO 8601. Safari won't parse the first form, and
// "Newest First" sorts by this.
function toIsoDate(value) {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/);
  const iso = match ? `${match[1]}T${match[2]}Z` : value;
  return ISO_8601.test(iso) && !Number.isNaN(Date.parse(iso)) ? iso : undefined;
}

// Fourthwall gives a variant only a flat title such as "Black, XS". Split it on
// ", " into option values and name each position as well as can be guessed: a
// position whose values all look like sizes is "Size" (once), the rest are
// "Option 1", "Option 2"... Titles that don't split the same way for every
// variant are kept whole as a single option.
function guessOptions(variantTitles) {
  if (variantTitles.length === 0) return { options: [], variantOptions: [] };
  if (variantTitles.length === 1 && PLACEHOLDER_TITLES.has(variantTitles[0].trim().toLowerCase())) {
    return { options: [], variantOptions: variantTitles.map(() => []) };
  }
  let rows = variantTitles.map((title) => title.split(", ").map((part) => part.trim()));
  if (rows.some((row) => row.length !== rows[0].length)) rows = variantTitles.map((title) => [title.trim()]);

  let sizeNamed = false;
  const options = rows[0].map((_, position) => {
    const values = [...new Set(rows.map((row) => row[position]))];
    const isSize = !sizeNamed && values.every(looksLikeSize);
    if (isSize) sizeNamed = true;
    return { name: isSize ? "Size" : `Option ${position + 1}`, values };
  });
  return { options, variantOptions: rows };
}

// Maps one raw collection entry onto the neutral product shape.
export function normalizeFourthwallProduct(raw, origin) {
  const basePrice = parseFloat(raw.price);
  const compareAt = parseFloat(raw.compare_at_price);
  // A malformed variant is skipped rather than failing the page.
  const rawVariants = Array.isArray(raw.variants) ? raw.variants.filter(isObject) : [];
  const { options, variantOptions } = guessOptions(rawVariants.map((v) => String(v.title ?? "")));
  const currency = rawVariants.find((v) => /^[A-Z]{3}$/.test(v.price?.currency_iso))?.price.currency_iso;
  // Stock is only reported for the product as a whole, so every variant shares
  // it. A product with no variants has nothing to buy, so isn't available. A
  // missing field isn't "sold out" (that would empty the in-stock view if the
  // feed dropped it): only an explicit false is.
  const available = rawVariants.length > 0 && raw.available !== false;

  const variants = rawVariants.map((v, i) => {
    const cents = toCents(v.price?.cents);
    const price = Number.isFinite(cents) ? cents / 100 : basePrice;
    return {
      id: v.id,
      title: options.length ? String(v.title) : "",
      price,
      // The compare-at price is the product's, so it applies to each variant
      // sold below it; a dearer variant (a bigger size) isn't on sale.
      compareAtPrice: compareAt > 0 && compareAt > price ? compareAt : null,
      available,
      options: variantOptions[i],
    };
  });

  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    url: productUrl(raw, origin),
    images: raw.image ? [{ url: raw.image }] : [],
    vendors: [],
    categories: [],
    tags: [],
    ...(currency ? { currency } : {}),
    available,
    ...(toIsoDate(raw.created_at) ? { createdAt: toIsoDate(raw.created_at) } : {}),
    variants,
    options,
  };
}

// Takes a pasted URL apart. A leading locale (/en-nzd) stays part of the origin so
// its market's prices carry through. `collection` is the slug from
// /collections/{slug}, /collections/{slug}.json, /collections/{slug}/products or
// /collections/{slug}/{n}[.json]; null for a bare store.
function parseUrl(url) {
  const match = url.pathname.match(COLLECTION_PATH);
  if (match) return { origin: `${url.origin}${match[1] ?? ""}`, collection: match[2] };
  const root = url.pathname.match(ROOT_LOCALE_PATH);
  return { origin: `${url.origin}${root?.[1] ?? ""}`, collection: null };
}

async function fetchCollection(collectionUrl, { signal, onProgress, maxPages = MAX_PRODUCT_PAGES } = {}) {
  const { origin, collection } = parseUrl(new URL(collectionUrl));
  if (!collection) throw new Error("Please enter a valid Fourthwall collection URL");
  // Fourthwall's error responses carry no CORS headers, so a bad slug looks
  // like an unreachable store to the browser. The shop's "all" collection tells
  // the two apart when the first page fails.
  const probe = () => probeUrl(`${new URL(origin).origin}/collections/${DEFAULT_COLLECTION}.json`, signal);

  const fetchPage = async (page) => {
    const diagnose = async (details) => {
      const err = await diagnoseFailure({ ...details, probe: page === 1 ? probe : undefined });
      // Page 1 proved the collection exists, so a later "not found" is the shop
      // no longer returning products, not a missing collection.
      return page > 1 && err.kind === "not-found" ? new StoreError("empty", { status: err.status, cause: err }) : err;
    };
    const request = () => fetchWithRetry(`${origin}/collections/${collection}/${page}.json`, { signal });
    let response;
    try {
      response = await request();
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      const diagnosis = await diagnose({ cause: err });
      if (diagnosis.kind !== "not-found" || page > 1) throw diagnosis;
      // The shop answers but this page threw. The feed's real 404 carries no
      // CORS headers, so it looks exactly like this, and so does a dropped
      // connection. Ask once more: a blip then loads the collection, where
      // calling it "not found" would also drop it from the visited list.
      try {
        response = await request();
      } catch (retryErr) {
        if (isAbort(retryErr, signal)) throw retryErr;
        throw diagnosis;
      }
    }
    if (!response.ok) throw await diagnose({ status: response.status });

    let data;
    try {
      data = await response.json();
    } catch (err) {
      if (isAbort(err, signal)) throw err;
      throw err instanceof SyntaxError ? new StoreError("unsupported-platform", { cause: err }) : await diagnose({ cause: err });
    }
    if (!Array.isArray(data?.products)) throw new StoreError("unsupported-platform");
    // Never "done" from a page's size: the end is an empty page, whatever the
    // page size turns out to be.
    return { items: data.products.filter(isObject).map((raw) => normalizeFourthwallProduct(raw, origin)), done: false };
  };

  const { items, pageError, truncated } = await fetchPages({
    fetchPage,
    concurrency: CONCURRENCY,
    maxPages,
    signal,
    onProgress,
  });

  const notices = items.some((product) => product.options.length > 0)
    ? [
        {
          level: "info",
          message:
            'Fourthwall doesn\'t name variant options, so StoreLens guesses the names: a size is labelled "Size" and anything else "Option 1", "Option 2"… Filtering by these names may group unrelated options.',
        },
      ]
    : [];
  return { products: items, pageError, truncated, notices };
}

// One detection request: "yes" (a Fourthwall product list), "no" (an answer
// that says it isn't, or a throw: a host that isn't a store or sends no CORS
// headers), or "unsure" (a rate limit, a server error or no answer in time),
// which says nothing about the platform. Only a user abort is rethrown.
async function askIfFourthwall(url, signal) {
  const timeout = new AbortController();
  const onAbort = () => timeout.abort();
  const timer = setTimeout(onAbort, DETECT_TIMEOUT_MS);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(`${url.origin}/collections/${DEFAULT_COLLECTION}.json`, { signal: timeout.signal });
    if (response.status === 429 || response.status >= 500) return "unsure";
    if (!response.ok) return "no";
    const data = await response.json();
    return Array.isArray(data?.products) && typeof data.current_page === "number" ? "yes" : "no";
  } catch (err) {
    if (signal?.aborted) throw err;
    return timeout.signal.aborted ? "unsure" : "no";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// Asks whether the store is on Fourthwall: its "all" collection answers with
// {current_page, products}, where Shopify answers {collection} (or a plain 404).
// Not being Fourthwall is the usual answer and must be quick, so a clear "no"
// is final after one request with a short timeout. Only an inconclusive answer
// (slow, rate-limited or failing, as a Fourthwall custom domain can be on a cold
// cache) is asked once more after a pause; if still unsure, it isn't claimed.
// Only a user abort is rethrown.
async function detect(url, { signal } = {}) {
  const first = await askIfFourthwall(url, signal);
  if (first !== "unsure") return first === "yes";
  await pause(DETECT_RETRY_DELAY_MS, signal);
  return (await askIfFourthwall(url, signal)) === "yes";
}

/** @type {import("./types").PlatformAdapter} */
export const fourthwallAdapter = {
  id: PLATFORM_ID,
  name: "Fourthwall",
  labels: { vendors: "Vendor", categories: "Type" },
  capabilities: {
    vendors: false,
    categories: false,
    tags: false,
    variantOptions: true,
    variantStock: true,
    collectionDiscovery: false,
  },
  // Only a pasted page URL (…/collections/{slug}/{n}.json) is recognisable;
  // every other Fourthwall store, custom domains included, is found by detect().
  matchesUrl: (url) => /\/collections\/[^/]+\/\d+\.json$/i.test(url.pathname),
  detect,
  parseUrl,
  collectionUrl: (origin, collection) => `${origin}/collections/${collection}`,
  // No collection listing is readable from the browser, so a bare store opens
  // its "all" collection, and the collection dropdown offers only that and the
  // collection on screen, with this note explaining why.
  defaultCollection: DEFAULT_COLLECTION,
  collectionsNote: "Fourthwall doesn't let StoreLens list a shop's collections. To view another, paste its link.",
  fetchCollection,
};
