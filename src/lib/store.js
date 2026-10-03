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

export function getDisplayHost(url) {
  return url.host;
}

// Bumping this invalidates every previously cached entry (old ones are just
// orphaned under their old key) whenever the discovery/probe logic changes
// in a way that could make stale cached results wrong or outdated. v3: keys
// now include the platform, so one origin can't serve another platform's
// collections.
const CACHE_VERSION = 3;
const CACHE_PREFIX = `storelens:collections:v${CACHE_VERSION}:`;
const TTL_MS = 21600000;

const cacheKey = (platformId, origin) => `${CACHE_PREFIX}${platformId}:${origin}`;

export function loadCollectionsCache(platformId, origin) {
  try {
    const raw = localStorage.getItem(cacheKey(platformId, origin));
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

export function saveCollectionsCache(platformId, origin, collections, allProductsHandle) {
  try {
    const payload = {
      cachedAt: Date.now(),
      ttlMs: TTL_MS,
      collections,
      allProductsHandle: allProductsHandle ?? null,
    };
    localStorage.setItem(cacheKey(platformId, origin), JSON.stringify(payload));
  } catch {
    /* noop */
  }
}
