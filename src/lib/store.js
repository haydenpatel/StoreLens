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

const CACHE_PREFIX = "storelens:collections:";
const TTL_MS = 21600000;

export function loadCollectionsCache(origin) {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${origin}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { cachedAt, ttlMs, collections } = parsed;
    if (!cachedAt || !ttlMs || !Array.isArray(collections)) return null;
    if (Date.now() - cachedAt >= ttlMs) return null;
    return collections;
  } catch {
    return null;
  }
}

export function saveCollectionsCache(origin, collections) {
  try {
    const payload = {
      cachedAt: Date.now(),
      ttlMs: TTL_MS,
      collections,
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

export async function discoverCollections(origin, signal) {
  const cached = loadCollectionsCache(origin);
  if (cached) {
    return cached;
  }

  const allCollections = [];
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

  const priorityHandles = ["all", "all-1", "all-products"];
  const filtered = allCollections
    .filter((c) => c.products_count > 0)
    .map((c) => ({
      handle: c.handle,
      title: c.title,
      products_count: c.products_count,
    }))
    .sort((a, b) => {
      const aIndex = priorityHandles.indexOf(a.handle);
      const bIndex = priorityHandles.indexOf(b.handle);

      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;

      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });

  saveCollectionsCache(origin, filtered);
  return filtered;
}
