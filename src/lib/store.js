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

// An origin without its scheme, keeping any locale prefix, e.g.
// "shop.example.com/en-nz". This is what the store box shows, so submitting it
// again reloads the same market.
export function getDisplayOrigin(origin) {
  const url = new URL(origin);
  return `${url.host}${url.pathname.replace(/\/$/, "")}`;
}

// The app path for a store or collection URL: "/{host}{pathname}", the same
// shape loadFromLocation reads back, so an address can be rebuilt from it.
export function appPathFor(url) {
  const { host, pathname } = new URL(url);
  return `/${host}${pathname}`.replace(/\/+$/, "");
}

// Whether the address bar already shows `path`. The host segment is a plain
// path segment here, so the browser keeps whatever case a link used; a
// trailing slash doesn't make it a different page.
export function addressMatches(path, pathname) {
  const normalize = (p) => p.replace(/^\/[^/]+/, (host) => host.toLowerCase()).replace(/\/+$/, "");
  return normalize(path) === normalize(pathname);
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

// Which platform an origin is on, remembered so a repeat visit skips the network
// check that tells platforms apart. Only ever written on positive evidence (a
// platform positively detected, or a load that succeeded), so a flaky request can
// never pin a store to the wrong platform. One entry per origin (not per locale).
// Bump the version if the detection logic changes in a way that could make a
// cached answer wrong.
const PLATFORM_CACHE_PREFIX = "storelens:platform:v1:";
const PLATFORM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function loadPlatformCache(origin) {
  try {
    const raw = localStorage.getItem(`${PLATFORM_CACHE_PREFIX}${origin}`);
    if (!raw) return null;
    const { cachedAt, platformId } = JSON.parse(raw) ?? {};
    if (typeof platformId !== "string" || !cachedAt || Date.now() - cachedAt >= PLATFORM_TTL_MS) return null;
    return platformId;
  } catch {
    return null;
  }
}

export function savePlatformCache(origin, platformId) {
  try {
    localStorage.setItem(`${PLATFORM_CACHE_PREFIX}${origin}`, JSON.stringify({ cachedAt: Date.now(), platformId }));
  } catch {
    /* noop */
  }
}

export function clearPlatformCache(origin) {
  try {
    localStorage.removeItem(`${PLATFORM_CACHE_PREFIX}${origin}`);
  } catch {
    /* noop */
  }
}

// "mens-apparel" -> "Mens Apparel": the title shown for a collection known only by its handle.
export function titleFromHandle(handle) {
  return handle.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// For a platform that can't list a shop's collections, the ones the user has
// opened, so the collection dropdown can offer them next time. One localStorage
// entry holding only handles, per shop (by plain origin: collections are the
// same in every locale), kept small on purpose: at most 20 collections a shop
// and 25 shops, dropping the least recently used.
const VISITED_KEY = "storelens:visited-collections:v1";
const MAX_VISITED_PER_SHOP = 20;
const MAX_VISITED_SHOPS = 25;
const validHandle = (handle) => typeof handle === "string" && handle.length > 0 && handle.length <= 100 && !/[/\s]/.test(handle);

function readVisited() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VISITED_KEY));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, handles]) => Array.isArray(handles))
        .map(([origin, handles]) => [origin, handles.filter(validHandle)])
    );
  } catch {
    return {};
  }
}

function writeVisited(visited) {
  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify(visited));
  } catch {
    /* noop */
  }
}

// Most recently opened first.
export function loadVisitedCollections(origin) {
  return readVisited()[origin] ?? [];
}

export function saveVisitedCollection(origin, handle) {
  if (!validHandle(handle)) return;
  const visited = readVisited();
  const handles = [handle, ...(visited[origin] ?? []).filter((h) => h !== handle)].slice(0, MAX_VISITED_PER_SHOP);
  // Re-insert so this shop is the most recently used (object order is insertion order).
  delete visited[origin];
  visited[origin] = handles;
  const shops = Object.keys(visited);
  for (const old of shops.slice(0, Math.max(0, shops.length - MAX_VISITED_SHOPS))) delete visited[old];
  writeVisited(visited);
}

// A collection that no longer loads shouldn't keep being offered.
export function forgetVisitedCollection(origin, handle) {
  const visited = readVisited();
  if (!visited[origin]?.includes(handle)) return;
  visited[origin] = visited[origin].filter((h) => h !== handle);
  if (visited[origin].length === 0) delete visited[origin];
  writeVisited(visited);
}
