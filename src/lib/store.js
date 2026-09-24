export function parseUserInputToURL(input) {
  try {
    const value = input?.trim();
    if (!value) return null;
    const prefixed = value.startsWith("http") ? value : `https://${value}`;
    return new URL(prefixed);
  } catch {
    return null;
  }
}

export function getOrigin(url) {
  return url.origin;
}

export function getDisplayHost(url) {
  return url.host;
}

export function extractCollectionHandle(url) {
  const match = url.pathname.match(/^\/collections\/([^/]+)/);
  return match ? match[1] : null;
}

// Bumping this invalidates every previously cached entry (old ones are just
// orphaned under their old key) whenever the discovery/probe logic changes
// in a way that could make stale cached results wrong or outdated.
const CACHE_VERSION = 2;
const CACHE_PREFIX = `storelens:collections:v${CACHE_VERSION}:`;
const TTL_MS = 21600000;

export function loadCollectionsCache(origin) {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${origin}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { cachedAt, ttlMs, collections, allProductsHandle } = parsed;
    if (!cachedAt || !ttlMs || !Array.isArray(collections)) return null;
    if (Date.now() - cachedAt >= ttlMs) return null;
    return { collections, allProductsHandle: allProductsHandle ?? null };
  } catch {
    return null;
  }
}

export function saveCollectionsCache(origin, collections, allProductsHandle) {
  try {
    const payload = {
      cachedAt: Date.now(),
      ttlMs: TTL_MS,
      collections,
      allProductsHandle: allProductsHandle ?? null,
    };
    localStorage.setItem(`${CACHE_PREFIX}${origin}`, JSON.stringify(payload));
  } catch {
    /* noop */
  }
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

export async function discoverCollections(origin, signal, { forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : loadCollectionsCache(origin);
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

  saveCollectionsCache(origin, filtered, allProductsHandle);
  return { collections: filtered, allProductsHandle };
}
