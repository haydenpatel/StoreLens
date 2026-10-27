import React, { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import Notice from "../components/Notice";
import { Button } from "@/components/ui/button";

import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import ProductGrid from "../components/ProductGrid";

import {
  buildFilterSearch,
  computeFilterData,
  countActiveFilters,
  filterAndSortProducts,
  parseFilterParams,
  restoreListSelections,
  restoreOptionSelections,
  restorePriceRange,
  withSearchText,
} from "@/lib/filters";
import {
  addressMatches,
  appPathFor,
  forgetVisitedCollection,
  getDisplayOrigin,
  loadVisitedCollections,
  parseUserInputToURL,
  saveVisitedCollection,
  titleFromHandle,
} from "@/lib/store";
import { defaultAdapter, forgetAdapter, rememberAdapter, resolveAdapter, supportNotes, supportedPlatformNames } from "@/lib/platforms";
import { formatCount, formatNumber } from "@/lib/locale";
import { StoreError, describeStoreError, describeStoreErrorReason } from "@/lib/errors";

// What describeStoreError needs to name the platforms that work.
const errorContext = () => ({ supported: supportedPlatformNames(), notes: supportNotes() });

// Where Recent Stores lived before the key was renamed from shopify-specific.
const LEGACY_HISTORY_KEY = "shopify-url-history";
const HISTORY_KEY = "storelens-url-history";

const DEFAULT_SORT = "title-asc";

const NO_COLLECTIONS = {
  status: "idle",
  collections: [],
  error: null,
  allProductsHandle: null,
  // The list may be incomplete (a request failed transiently): offer a retry.
  partial: false,
};

// Recent Stores as saved in localStorage; read once when the page mounts.
function readSavedHistory() {
  try {
    let saved = localStorage.getItem(HISTORY_KEY);
    // Carry Recent Stores over from the key used before it was renamed.
    const legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (saved === null && legacy !== null) {
      saved = legacy;
      localStorage.setItem(HISTORY_KEY, legacy);
    }
    localStorage.removeItem(LEGACY_HISTORY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Anything but an array of strings would break the header's list.
      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
        return parsed;
      }
    }
  } catch {
    /* localStorage unavailable or history corrupted — ignore */
  }
  return [];
}

export default function StoreLensApp() {
  const [storeInput, setStoreInput] = useState("");
  const [storeOrigin, setStoreOrigin] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  // True while a pasted URL is being resolved to a platform, which can take a
  // network request for a store that can't be recognised from its URL.
  const [resolving, setResolving] = useState(false);
  // Products fetched so far by the load in progress, for large collections.
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState(null);
  // Shown as info: nothing is wrong, but the user has a next step to take.
  const [infoNotice, setInfoNotice] = useState(null);
  // Shown as a warning: the list on screen is incomplete (a page failed, or the
  // platform's paging limit was hit).
  const [loadWarning, setLoadWarning] = useState(null);
  // Shown as a warning: parts of a shared link (filters) that couldn't be applied.
  const [linkWarning, setLinkWarning] = useState(null);
  // Shown beside the products: things about this load the platform says to
  // mention (e.g. guessed option names). Replaced by each load.
  const [platformNotices, setPlatformNotices] = useState([]);
  // Clears the message shown in place of the product list (error or info).
  const clearMessage = () => {
    setError(null);
    setInfoNotice(null);
  };
  const [urlHistory, setUrlHistory] = useState(readSavedHistory);
  const [collectionsState, setCollectionsState] = useState(NO_COLLECTIONS);
  const [selectedHandle, setSelectedHandle] = useState("");
  const [currentCollectionUrl, setCurrentCollectionUrl] = useState("");
  // Bumped once per successful load, even when it reloads the collection that
  // is already on screen (so currentCollectionUrl doesn't change).
  const [loadVersion, setLoadVersion] = useState(0);
  const [inputHandle, setInputHandle] = useState("");

  // Keep the currently-loaded collection selectable in the dropdown even when
  // the platform's collection discovery didn't happen to include it —
  // otherwise the Select ends up holding a value with no matching item.
  if (collectionsState.status === "ready" && inputHandle) {
    if (selectedHandle !== inputHandle) setSelectedHandle(inputHandle);
    if (!collectionsState.collections.some((c) => c.handle === inputHandle)) {
      setCollectionsState({
        ...collectionsState,
        collections: [{ handle: inputHandle, title: titleFromHandle(inputHandle), products_count: null, addedForLoad: true }, ...collectionsState.collections],
      });
    }
  }

  // No store, no collection list: drop whatever the last store left behind.
  if (!storeOrigin && collectionsState !== NO_COLLECTIONS) {
    setCollectionsState(NO_COLLECTIONS);
  }

  const [discoveryRetryNonce, setDiscoveryRetryNonce] = useState(0);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  // The platform adapter for the store being browsed. A ref mirrors the state
  // so async loads (which run right after applyUserInput sets it) see the
  // adapter chosen for the current input, not the previous render's.
  const [adapter, setAdapter] = useState(defaultAdapter);
  const mainRef = useRef(null);
  // Close the filter drawer; if focus is inside it, hand focus to the main area
  // first so a load that unmounts the sidebar doesn't drop focus to <body>.
  const closeFilterDrawer = () => {
    const aside = document.querySelector("aside");
    if (aside?.contains(document.activeElement)) mainRef.current?.focus();
    setIsFilterDrawerOpen(false);
  };
  const adapterRef = useRef(defaultAdapter);
  // The adapter that loaded the products on screen. Filters, counts and the
  // sidebar follow this, not `adapter`: pasting another store changes
  // `adapter` immediately, while the previous store's products stay displayed
  // until the new load completes.
  const [loadedAdapter, setLoadedAdapter] = useState(defaultAdapter);
  const forceRefreshDiscoveryRef = useRef(false);
  // Set while a bare domain waits for discovery to pick the collection to open,
  // null otherwise. `fromAddressBar` says whether that input came from the
  // address bar (a deep link, Back/Forward) rather than from the user pasting or
  // choosing it; it travels with the pending auto-load because the load starts
  // later, after discovery.
  const autoLoadPendingRef = useRef(null);
  // Mirrors whether autoLoadPendingRef is set, for the render: the prompt to enter
  // a URL must not show while a bare domain waits for discovery to open its
  // collection. Always set through setAutoLoadPending.
  const [autoLoadWaiting, setAutoLoadWaiting] = useState(false);
  const setAutoLoadPending = (pending) => {
    autoLoadPendingRef.current = pending;
    setAutoLoadWaiting(pending !== null);
  };
  // The auto-load a discovery consumed without opening anything (it failed, or
  // found no all-products collection). Retry re-arms it, so a retry that works
  // opens the collection the user was waiting for. Dropped as soon as anything
  // else is opened or another store is entered.
  const unfulfilledAutoLoadRef = useRef(null);
  // Aborts the store resolution (which adapter handles a pasted URL) still
  // running for an earlier input, so a slow one can't land after a newer paste.
  const resolveAbortRef = useRef(null);
  // Filter/sort state parsed from the URL's query string (by loadFromLocation),
  // waiting to be applied once a collection's own data has settled - see the
  // restore effect below for why it can't just be applied immediately.
  const pendingFilterParamsRef = useRef(null);
  // The store whose collection discovery has finished, null while it is running
  // or for a store not discovered yet. Read by loads, which run from closures of
  // an earlier render and so can't trust collectionsState.
  const discoveredOriginRef = useRef(null);
  // Whether the input being worked on came from the address bar; Recent Stores
  // keeps its order for those, since Back/Forward only revisits a store.
  const inputFromAddressBarRef = useRef(false);
  // `keepOrder`: a store already in Recent Stores stays where it is.
  const updateHistoryEntry = (entry, { keepOrder = false } = {}) => {
    if (!entry) return;
    setUrlHistory((prev) => {
      if (keepOrder && prev.includes(entry)) return prev;
      const updated = [entry, ...prev.filter((u) => u !== entry)].slice(0, 5);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      } catch {
        /* localStorage unavailable (quota exceeded, private browsing, blocked) */
      }
      return updated;
    });
  };
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVendors, setSelectedVendors] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [priceRange, setPriceRange] = useState([0, 10000]);

  // Extract unique filter values
  const filterData = useMemo(() => computeFilterData(products), [products]);

  // Update price range when products change
  const [priceRangeFor, setPriceRangeFor] = useState(filterData);
  if (priceRangeFor !== filterData) {
    setPriceRangeFor(filterData);
    if (filterData.minPrice !== Infinity && filterData.maxPrice !== 0) {
      setPriceRange([filterData.minPrice, filterData.maxPrice]);
    }
  }

  const [inStockOnly, setInStockOnly] = useState(false);
  const [saleOnly, setSaleOnly] = useState(false);
  const [sortBy, setSortBy] = useState(DEFAULT_SORT);

  // Back/Forward can kick off a new load while a previous one is still
  // in-flight (rapid navigation) - without tracking which call is current,
  // an older, slower response could resolve after a newer one and clobber
  // it, leaving the UI showing one collection while the address bar (and
  // the rest of the app's state) points at another.
  const fetchCollectionAbortRef = useRef(null);

  // Whether the load that put the current collection on screen was asked for by
  // the address bar (a deep link or Back/Forward) rather than chosen by the user.
  // The address is then already an entry of its own, so the URL-sync effect only
  // normalizes it with replaceState: a bare domain's auto-resolved default, or a
  // link to a path that isn't the collection's canonical one.
  const lastLoadWasFromAddressBarRef = useRef(false);

  // Nothing is going to show for the store or collection just asked for (its
  // discovery found nothing to open, or its collection failed to load), so drop
  // the previous page: no stale grid or filters under the new message, and an
  // address bar that names what was asked for instead of what is gone (`path`;
  // null leaves the address alone). The attempt is pushed so Back returns to the
  // previous page; one that came from the address bar itself (a deep link,
  // Back/Forward) only normalizes in place, since pushing there would trap Back
  // in a loop.
  const showFailedStore = (path, fromAddressBar) => {
    closeFilterDrawer();
    setProducts([]);
    setCurrentCollectionUrl("");
    if (!path || addressMatches(path, window.location.pathname)) return;
    if (fromAddressBar) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
  };

  // A collection that failed to load is no longer the one chosen: the dropdown
  // goes back to its placeholder, and the entry added only to hold that selection
  // goes (one the store's own listing has stays).
  const forgetFailedCollection = (platform, url) => {
    const { collection } = platform.parseUrl(new URL(url));
    setInputHandle("");
    setSelectedHandle("");
    if (!collection) return;
    setCollectionsState((prev) =>
      prev.collections.some((c) => c.addedForLoad && c.handle === collection)
        ? { ...prev, collections: prev.collections.filter((c) => !(c.addedForLoad && c.handle === collection)) }
        : prev
    );
  };

  // For a platform that can't list its collections: which collection a URL is,
  // if it isn't the default one that is always offered.
  const unlistedCollection = (platform, url) => {
    if (platform.capabilities.collectionDiscovery !== false) return null;
    const { collection } = platform.parseUrl(new URL(url));
    return collection && collection !== platform.defaultCollection ? collection : null;
  };
  const rememberVisitedCollection = (platform, url) => {
    const collection = unlistedCollection(platform, url);
    if (collection) saveVisitedCollection(new URL(url).origin, collection);
  };
  const forgetVisitedCollectionFor = (platform, url) => {
    const collection = unlistedCollection(platform, url);
    if (collection) forgetVisitedCollection(new URL(url).origin, collection);
  };

  // `fromAddressBar`: the load was asked for by the address bar (a deep link or
  // Back/Forward), not by the user pasting or choosing something; it decides
  // whether a failure replaces or pushes the history entry, and whether
  // filters waiting from the link still apply.
  const fetchCollection = async (url, { fromAddressBar = false } = {}) => {
    fetchCollectionAbortRef.current?.abort();
    const controller = new AbortController();
    fetchCollectionAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted;
    // Any load that doesn't come from the address bar supersedes whatever
    // pending URL-driven filters might still be waiting for a load that
    // failed or was itself superseded before it could consume them - a
    // manually chosen collection should never inherit someone else's
    // leftover filter state.
    if (!fromAddressBar) {
      pendingFilterParamsRef.current = null;
    }

    setLoading(true);
    setLoadProgress(0);
    clearMessage();
    setLoadWarning(null);
    setLinkWarning(null);
    setPlatformNotices([]);
    closeFilterDrawer();
    setProducts([]);

    // Captured once: the user can paste a different store while this load is
    // still in flight, which swaps adapterRef for the new store's adapter.
    const loadAdapter = adapterRef.current;
    let result;
    try {
      result = await loadAdapter.fetchCollection(url, {
        signal: controller.signal,
        onProgress: ({ loaded }) => {
          if (isCurrent()) setLoadProgress(loaded);
        },
      });
    } catch (err) {
      // Superseded (aborted) - the newer call owns state from here. Anything
      // else, e.g. an invalid collection URL, is reported to the user.
      if (isCurrent()) {
        setError(describeStoreError(err, errorContext()));
        setLoading(false);
        forgetAdapter(new URL(url));
        forgetFailedCollection(loadAdapter, url);
        showFailedStore(appPathFor(url), fromAddressBar);
      }
      return;
    }

    if (!isCurrent()) return;

    const { products: allProducts, pageError, truncated, notices } = result;

    if (allProducts.length === 0) {
      // What was remembered about this store's platform may be out of date.
      forgetAdapter(new URL(url));
      // Only the shop saying it has no such collection means it is gone; being
      // offline, blocked or throttled says nothing about the collection.
      if (pageError?.kind === "not-found") forgetVisitedCollectionFor(loadAdapter, url);
      setError(describeStoreError(pageError ?? new StoreError("empty"), errorContext()));
      setLoading(false);
      forgetFailedCollection(loadAdapter, url);
      showFailedStore(appPathFor(url), fromAddressBar);
      return;
    }

    // Wrapped in finally: updateHistoryEntry writes to localStorage, which
    // can throw (quota exceeded, private browsing, storage blocked) — that
    // shouldn't leave the loading spinner stuck when products already loaded.
    try {
      setProducts(withSearchText(allProducts));
      setLoadedAdapter(loadAdapter);
      setPlatformNotices(notices ?? []);
      // The load worked, so the store really is on this platform.
      rememberAdapter(new URL(url), loadAdapter);
      rememberVisitedCollection(loadAdapter, url);
      setCurrentCollectionUrl(url);
      setLoadVersion((version) => version + 1);
      lastLoadWasFromAddressBarRef.current = fromAddressBar;
      resetFilters();

      if (pageError) {
        setLoadWarning(
          `Loaded ${formatCount(allProducts.length)} products, but couldn't fetch the rest (${describeStoreErrorReason(pageError)}).`
        );
      } else if (truncated) {
        setLoadWarning(
          `This collection is larger than StoreLens can load from ${loadAdapter.name} — showing the first ${formatCount(allProducts.length)} products.`
        );
      }

      // Domain only, never the collection path - a collection URL here would
      // otherwise bump other domains out of Recent Stores every time someone just
      // browses collections within the same store. The store's origin including
      // any locale, so Recent Stores reopens the same market. Skipped once the
      // store's discovery has made its own entry (the ref, not collectionsState:
      // this closure may predate the store being switched).
      const storeOfLoad = loadAdapter.parseUrl(new URL(url)).origin;
      if (discoveredOriginRef.current !== storeOfLoad) {
        updateHistoryEntry(storeOfLoad, { keepOrder: fromAddressBar });
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
      }
    }
  };

  const loadCollectionByHandle = async (handle, origin = storeOrigin, loadOptions) => {
    if (!handle || !origin) {
      setError("Please select a collection to load.");
      return;
    }
    unfulfilledAutoLoadRef.current = null;
    const url = adapterRef.current.collectionUrl(origin, handle);
    setSelectedHandle(handle);
    setInputHandle(handle);
    await fetchCollection(url, loadOptions);
  };

  // Called only from explicit, discrete actions (submit, paste, history
  // selection, the address bar) — never on every keystroke — so it always
  // resolves the input: working out which platform it is, normalizing the
  // display to a clean host, kicking off collection discovery, and loading a
  // collection URL's handle. Resolving the platform is async, so everything
  // after it only happens if no newer input has superseded this one.
  // `fromAddressBar` is true when it came from the address bar (see fetchCollection).
  const applyUserInput = async (value, { fromAddressBar = false } = {}) => {
    resolveAbortRef.current?.abort();
    const resolution = new AbortController();
    resolveAbortRef.current = resolution;
    // Whatever collection was still loading belongs to the store being left, and
    // must not finish later over the page this input is about to show.
    fetchCollectionAbortRef.current?.abort();
    setLoading(false);
    inputFromAddressBarRef.current = fromAddressBar;
    // Every way of switching store comes through here (paste, submit, Recent
    // Stores, Back/Forward), so a message about the previous one must not linger.
    clearMessage();
    const parsed = parseUserInputToURL(value);
    if (!parsed) {
      setResolving(false);
      setStoreInput(value);
      setStoreOrigin("");
      setInputHandle("");
      setSelectedHandle("");
      setAutoLoadPending(null);
      pendingFilterParamsRef.current = null;
      // Nothing is left to show: drop the previous page like a failed load does
      // (a link in the address bar keeps its address).
      showFailedStore(fromAddressBar ? null : "/", fromAddressBar);
      // Only surface an error for genuinely invalid input — an empty
      // submission (e.g. pressing Enter on an empty box) isn't a mistake.
      if (value?.trim()) {
        setError("Please enter a valid store or collection URL");
      }
      return;
    }
    // A valid new input replaces whatever store was still waiting on discovery.
    setAutoLoadPending(null);
    unfulfilledAutoLoadRef.current = null;
    // Show what was entered at once (a paste is intercepted, so the box would
    // stay empty while a slow platform check runs); it is tidied up below.
    setStoreInput(value);
    setResolving(true);
    let detected;
    try {
      detected = await resolveAdapter(parsed, { signal: resolution.signal });
    } catch (err) {
      // Superseded: the newer input owns state from here.
      if (!resolution.signal.aborted) {
        setResolving(false);
        setError(describeStoreError(err, errorContext()));
      }
      return;
    }
    if (resolution.signal.aborted) return;
    setResolving(false);
    adapterRef.current = detected;
    setAdapter(detected);
    const { origin, collection: handle } = detected.parseUrl(parsed);
    setStoreInput(getDisplayOrigin(origin));
    setStoreOrigin(origin);
    setInputHandle(handle || "");
    if (handle) {
      loadCollectionByHandle(handle, origin, { fromAddressBar });
    } else {
      // Bare domain: no collection path to load directly. Once discovery
      // resolves, auto-load its best guess (e.g. the store's all-products
      // collection) instead of leaving the user stuck on an empty page.
      setSelectedHandle("");
      setCurrentCollectionUrl("");
      setAutoLoadPending({ fromAddressBar, origin });
    }
    setDiscoveryRetryNonce((n) => n + 1);
  };

  const handleSubmitStoreInput = () => {
    clearMessage();
    applyUserInput(storeInput);
  };

  // Deep link support: /<domain> or /<domain><collection path> in the
  // URL path loads that store (and collection, if given) - on first load,
  // and again on Back/Forward. That's the same shape applyUserInput()
  // already accepts from the paste box, so no separate parsing is needed -
  // a bare domain still falls through to its existing "load all products"
  // default.
  const loadFromLocation = () => {
    // A corrupted/mangled link (some chat and email clients do this to URLs)
    // can carry invalid percent-encoding, which throws rather than just
    // producing a garbled string - fall back to the raw pathname so a bad
    // link degrades to "invalid store" instead of crashing the app outright.
    let rawPath = window.location.pathname.slice(1);
    try {
      rawPath = decodeURIComponent(rawPath);
    } catch {
      /* malformed percent-encoding - use the raw, undecoded path as-is */
    }
    const path = rawPath.replace(/\/$/, "");
    if (path) {
      // An entry without a query still has its say: no filters, and no sort.
      pendingFilterParamsRef.current = parseFilterParams(window.location.search) ?? {};
      applyUserInput(path, { fromAddressBar: true });
    } else {
      // Back at the empty page: applyUserInput drops the store, cancels any load
      // still running and clears the page.
      pendingFilterParamsRef.current = null;
      applyUserInput("", { fromAddressBar: true });
    }
  };

  useEffect(() => {
    // The address bar is the external system here: opening the page on a store
    // link loads it, just as Back/Forward does through the popstate listener.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFromLocation();
    window.addEventListener("popstate", loadFromLocation);
    return () => {
      window.removeEventListener("popstate", loadFromLocation);
      resolveAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ...and the other direction: once a collection finishes loading, reflect
  // it in the address bar so any point in a session is bookmarkable/
  // shareable, not just the page someone landed on. A load that itself came
  // from the URL (mount or Back/Forward) already leaves the address bar
  // matching, so the comparison below is naturally a no-op for it - no extra
  // "did this come from the URL" bookkeeping needed. A failed or invalid
  // load never reaches here at all, since currentCollectionUrl only changes
  // on a successful one, so there's nothing that can go stale.
  //
  // The exception: a load the address bar asked for (a deep link, Back/Forward)
  // already has its entry. A bare domain resolving to its store's default
  // collection is an auto-resolved implicit guess - pushing it would mean Back
  // from it lands on the bare-domain entry, which immediately re-resolves and
  // re-pushes the very same URL, truncating the forward stack and trapping
  // Back/Forward in a loop - and a non-canonical path would leave a duplicate
  // entry for the same page. replaceState instead normalizes the entry to the
  // collection's explicit URL in place, keeping its query.
  useEffect(() => {
    if (!currentCollectionUrl) return;
    const path = appPathFor(currentCollectionUrl);
    // addressMatches ignores the case of the domain segment (which keeps
    // whatever case the link used) and a trailing slash, so a mixed-case or
    // slash-terminated deep link doesn't look like a "change" and push a
    // spurious duplicate entry for what's already the same page.
    if (!addressMatches(path, window.location.pathname)) {
      if (lastLoadWasFromAddressBarRef.current) {
        window.history.replaceState(null, "", path + window.location.search);
      } else {
        window.history.pushState(null, "", path);
      }
    }
    // loadVersion: reloading the collection already on screen from a link with
    // another path still has to normalize that entry.
  }, [currentCollectionUrl, loadVersion]);

  // Set default filter values
  const resetFilters = () => {
    setSearchQuery("");
    setSelectedVendors([]);
    setSelectedTypes([]);
    setSelectedTags([]);
    setSelectedOptions({});
    setInStockOnly(true);
    setSaleOnly(false);
    setPriceRange([filterData.minPrice, filterData.maxPrice]);
  };

  // Discovery only ever runs from a discrete user action (submit, paste,
  // history selection, retry) now — never from continuous typing — so there's
  // no keystroke burst to debounce against; this runs as soon as storeOrigin
  // or discoveryRetryNonce changes.
  useEffect(() => {
    if (!storeOrigin) return;

    const controller = new AbortController();
    (async () => {
      setCollectionsState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
      }));
      discoveredOriginRef.current = null;
      const forceRefresh = forceRefreshDiscoveryRef.current;
      forceRefreshDiscoveryRef.current = false;
      try {
        const discoveryAdapter = adapterRef.current;
        // Platforms without a collection listing skip discovery and open
        // their default collection instead.
        const { collections, allProductsHandle, origin: resolvedOrigin, partial = false } =
          discoveryAdapter.capabilities.collectionDiscovery !== false && discoveryAdapter.listCollections
            ? await discoveryAdapter.listCollections(storeOrigin, controller.signal, { forceRefresh })
            : {
                // No listing to read: the dropdown offers the default collection and
                // the ones this shop has been opened on before.
                collections: [
                  { handle: discoveryAdapter.defaultCollection, title: "All Products", products_count: null },
                  ...loadVisitedCollections(new URL(storeOrigin).origin)
                    .filter((handle) => handle !== discoveryAdapter.defaultCollection)
                    .map((handle) => ({ handle, title: titleFromHandle(handle), products_count: null })),
                ],
                allProductsHandle: discoveryAdapter.defaultCollection ?? null,
              };
        if (!controller.signal.aborted && resolvedOrigin && resolvedOrigin !== storeOrigin) {
          // The adapter found the store under a different origin (e.g. /uk was
          // a page, not a locale). Switch to it and let discovery run again
          // (a cache hit, unless the result was partial: that isn't cached, so
          // it is discovered again) so the pending auto-load picks up from there.
          setStoreOrigin(resolvedOrigin);
          setStoreInput(getDisplayOrigin(resolvedOrigin));
          if (autoLoadPendingRef.current?.origin === storeOrigin) autoLoadPendingRef.current.origin = resolvedOrigin;
          return;
        }
        if (!controller.signal.aborted) {
          setCollectionsState({
            status: "ready",
            collections,
            error: null,
            allProductsHandle,
            partial,
          });
          discoveredOriginRef.current = storeOrigin;
          updateHistoryEntry(storeOrigin, { keepOrder: inputFromAddressBarRef.current });
          // Consume the flag here, against this exact discovery's fresh
          // result, rather than in a separate effect watching collectionsState:
          // that raced against a stale "ready" state left over from whichever
          // store was discovered previously, firing before this discovery
          // resolved and consuming the flag before it had real data to use.
          // The flag names the store it was set for: a discovery that is about to
          // be superseded must not consume the one set for the store replacing it.
          const pendingAutoLoad = autoLoadPendingRef.current?.origin === storeOrigin ? autoLoadPendingRef.current : null;
          if (pendingAutoLoad) {
            setAutoLoadPending(null);
            if (allProductsHandle) {
              // Only replaceState (via lastLoadWasFromAddressBarRef) when this bare
              // domain itself came from the address bar (a deep link or
              // Back/Forward) - a manually submitted bare domain (paste, history
              // select) should still push, so Back can return to whatever was
              // loaded before.
              loadCollectionByHandle(allProductsHandle, storeOrigin, { fromAddressBar: pendingAutoLoad.fromAddressBar });
            } else {
              unfulfilledAutoLoadRef.current = pendingAutoLoad;
              setInfoNotice(
                partial
                  ? "I couldn't automatically find an all-products collection, but the store didn't answer every request, so the list may be incomplete. Try the retry button, or choose a collection from the dropdown above."
                  : "I couldn't automatically find an all-products collection for this store. Please choose a collection from the dropdown above."
              );
              showFailedStore(appPathFor(storeOrigin), pendingAutoLoad.fromAddressBar);
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setCollectionsState({
            status: "error",
            collections: [],
            // Short: it sits in the collection dropdown. The full explanation is
            // the error below, when there is nothing else to show.
            error:
              err instanceof StoreError
                ? `Couldn't load collections: ${describeStoreErrorReason(err)}`
                : err.message || "Couldn't load collections for this store",
            allProductsHandle: null,
            partial: false,
          });
          const pendingAutoLoad = autoLoadPendingRef.current?.origin === storeOrigin ? autoLoadPendingRef.current : null;
          if (pendingAutoLoad) {
            setAutoLoadPending(null);
            unfulfilledAutoLoadRef.current = pendingAutoLoad;
            setError(
              err instanceof StoreError
                ? describeStoreError(err, errorContext())
                : "I couldn't find a collection of products to load. Please paste the full collection URL and try again."
            );
            showFailedStore(appPathFor(storeOrigin), pendingAutoLoad.fromAddressBar);
          }
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // loadCollectionByHandle is recreated each render; the autoLoadPendingRef
    // guard above prevents it from being invoked more than once per discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeOrigin, discoveryRetryNonce]);

  const handleRetryDiscovery = () => {
    forceRefreshDiscoveryRef.current = true;
    const unfulfilled = unfulfilledAutoLoadRef.current;
    unfulfilledAutoLoadRef.current = null;
    if (unfulfilled?.origin === storeOrigin) {
      setAutoLoadPending(unfulfilled);
      clearMessage();
    }
    setDiscoveryRetryNonce((n) => n + 1);
  };

  const handleInputChange = (value) => {
    // Just track what's typed; parsing the URL and kicking off collection
    // discovery on every keystroke re-rendered the whole app (including a
    // potentially large product grid), making typing feel sluggish. Actually
    // resolving the input now happens on submit (Enter or the Load button).
    clearMessage();
    setStoreInput(value);
  };

  const handlePaste = (value) => {
    clearMessage();
    applyUserInput(value);
  };

  const handleSelectHistory = (url) => {
    applyUserInput(url);
  };

  const handleSelectHandle = (handle) => {
    clearMessage();
    setSelectedHandle(handle);
    setInputHandle(handle);
    loadCollectionByHandle(handle, storeOrigin);
  };

  // Count of active filter groups (not total selected values within a group) -
  // shared between the mobile "Filters" toggle button's badge and Sidebar's
  // own Reset button, so the two stay in sync rather than each computing
  // "active" from a possibly-diverging copy of the same conditions.
  const activeFilterCount = useMemo(
    () => countActiveFilters(
      { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange },
      filterData,
      loadedAdapter.capabilities
    ),
    [searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange, filterData, loadedAdapter]
  );

  // Restore filter/sort state from the URL once a collection's own data has
  // settled - both resetFilters() (called on every successful load) and the
  // price-range effect above would otherwise immediately overwrite it with
  // defaults. Keyed on loadVersion (changes exactly once per successful load,
  // including a reload of the same collection with a different query string,
  // e.g. via Back/Forward) rather than filterData/products directly, since those
  // also transiently reset to empty at the START of a load, before the real
  // data arrives - reacting to that would apply these against the wrong
  // (empty) filterData and consume the pending params before the real
  // filterData was ever available to restore against.
  useEffect(() => {
    const pending = pendingFilterParamsRef.current;
    if (!pending || !currentCollectionUrl) return;
    pendingFilterParamsRef.current = null;
    if (pending.searchQuery !== undefined) setSearchQuery(pending.searchQuery);
    // Selections that don't fit this collection can't filter anything, so
    // they are dropped and named in one warning instead of emptying the list.
    // A platform without a filter can't populate it, so its selections are
    // never applied and there is nothing to report.
    const ignored = [];
    const restoreList = (selected, available, supported, label, setSelected) => {
      if (selected === undefined) return;
      if (!supported) {
        setSelected([]);
        return;
      }
      const restored = restoreListSelections(selected, available);
      setSelected(restored.values);
      restored.ignored.forEach(value => ignored.push(`${label}: ${value}`));
    };
    const { capabilities } = loadedAdapter;
    restoreList(pending.selectedVendors, filterData.vendors, capabilities.vendors !== false, "Vendor", setSelectedVendors);
    restoreList(pending.selectedTypes, filterData.types, capabilities.categories !== false, "Category", setSelectedTypes);
    restoreList(pending.selectedTags, filterData.tags, capabilities.tags !== false, "Tag", setSelectedTags);
    if (pending.selectedOptions !== undefined) {
      // Match saved option names and values to this collection's own labels.
      // Options it doesn't have can't filter anything.
      const restored = restoreOptionSelections(pending.selectedOptions, filterData.options);
      setSelectedOptions(restored.options);
      ignored.push(...restored.ignored);
    }
    if (pending.inStockOnly !== undefined) setInStockOnly(pending.inStockOnly);
    if (pending.saleOnly !== undefined) setSaleOnly(pending.saleOnly);
    if (pending.priceRange !== undefined) {
      // Clamped to this collection's prices; a range outside them is dropped
      // and the full range stays.
      const restored = restorePriceRange(pending.priceRange, filterData.minPrice, filterData.maxPrice);
      if (restored) setPriceRange(restored);
      else ignored.push(`Price: ${formatNumber(pending.priceRange[0])} - ${formatNumber(pending.priceRange[1])}`);
    }
    if (ignored.length > 0) {
      setLinkWarning(`Some filters in this link don't apply to this collection and were ignored (${ignored.join(", ")}).`);
    }
    // An entry is the whole view: with no sort in its link it is the default, so
    // Back/Forward can't carry the previous page's sort onto it. (Switching
    // collection by hand has no pending link, and keeps the sort.)
    setSortBy(pending.sortBy ?? DEFAULT_SORT);
    // Deliberately keyed on loadVersion alone (see above); products and
    // filterData are read from the same render that set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadVersion]);

  // ...and the write direction: reflect filter/sort state in the URL's query
  // string as it changes, so a filtered/sorted view is bookmarkable too - not
  // just the domain/collection. Always replaceState rather than pushState:
  // unlike switching collections, adjusting a filter isn't a distinct,
  // deliberate navigation someone would expect Back to step through one
  // change at a time, and pushing on every keystroke/checkbox would make
  // Back nearly unusable.
  //
  // Debounced: typing in the search box or dragging the price slider fires
  // this on every keystroke/step, and replaceState doesn't need to keep up
  // with each one - only the final value once things settle is worth
  // writing. Each change resets the pending write rather than queuing one.
  //
  // Nothing is written while a store is resolving or a collection loading: the
  // state is then the previous page's (or emptied for the load), while the
  // address may already be the next entry's. It is written once the load ends.
  useEffect(() => {
    if (!currentCollectionUrl || loading || resolving) return;
    const timeoutId = setTimeout(() => {
      // The address has moved on without the page (e.g. Back to a store that
      // then couldn't be resolved): these filters belong to another entry.
      if (!addressMatches(appPathFor(currentCollectionUrl), window.location.pathname)) return;
      const newSearch = buildFilterSearch(
        { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange, sortBy },
        filterData,
        loadedAdapter.capabilities
      );
      if (newSearch !== window.location.search) {
        window.history.replaceState(null, "", window.location.pathname + newSearch);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [
    currentCollectionUrl,
    loading,
    resolving,
    searchQuery,
    selectedVendors,
    selectedTypes,
    selectedTags,
    selectedOptions,
    inStockOnly,
    saleOnly,
    priceRange,
    sortBy,
    filterData,
    loadedAdapter,
  ]);

  // Filter products
  const filteredProducts = useMemo(
    () => filterAndSortProducts(
      products,
      { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, priceRange, inStockOnly, saleOnly, sortBy },
      loadedAdapter.capabilities
    ),
    [products, searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, priceRange, inStockOnly, saleOnly, sortBy, loadedAdapter]
  );

  return (
    <div className="min-h-screen flex flex-col bg-secondary">
      <Header
        storeInput={storeInput}
        onStoreInputChange={handleInputChange}
        onStorePaste={handlePaste}
        onLoad={handleSubmitStoreInput}
        loading={loading}
        resolving={resolving}
        urlHistory={urlHistory}
        onSelectHistory={handleSelectHistory}
        collections={collectionsState.collections}
        collectionsNote={adapter.collectionsNote}
        collectionsStatus={collectionsState.status}
        collectionsError={collectionsState.error}
        collectionsPartial={collectionsState.partial}
        selectedHandle={selectedHandle}
        onSelectHandle={handleSelectHandle}
        onRetryCollections={handleRetryDiscovery}
      />

      <div className="flex flex-1">
        {products.length > 0 && (
          <Sidebar
            filterData={filterData}
            capabilities={loadedAdapter.capabilities}
            labels={loadedAdapter.labels}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            selectedVendors={selectedVendors}
            setSelectedVendors={setSelectedVendors}
            selectedTypes={selectedTypes}
            setSelectedTypes={setSelectedTypes}
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            selectedOptions={selectedOptions}
            setSelectedOptions={setSelectedOptions}
            priceRange={priceRange}
            setPriceRange={setPriceRange}
            inStockOnly={inStockOnly}
            setInStockOnly={setInStockOnly}
            saleOnly={saleOnly}
            setSaleOnly={setSaleOnly}
            onReset={resetFilters}
            activeFilterCount={activeFilterCount}
            isOpen={isFilterDrawerOpen}
            onClose={() => setIsFilterDrawerOpen(false)}
          />
        )}

        <main ref={mainRef} tabIndex={-1} className="outline-none flex-1 p-4 sm:p-6 bg-background border-sidebar-border border-l">
          {!loading && products.length > 0 && (
            <Button
              variant="outline"
              className="mb-4 xl:hidden"
              onClick={() => setIsFilterDrawerOpen(true)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters{activeFilterCount > 0 && ` (${formatCount(activeFilterCount)})`}
            </Button>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 h-64">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              {loadProgress > 0 && (
                <p className="text-sm text-muted-foreground">
                  Loaded {formatCount(loadProgress)} products…
                </p>
              )}
            </div>
          )}

          {error && <Notice level="error">{error}</Notice>}

          {infoNotice && (
            <Notice level="info" onDismiss={() => setInfoNotice(null)}>{infoNotice}</Notice>
          )}

          {!loading && linkWarning && products.length > 0 && (
            <Notice level="warning" onDismiss={() => setLinkWarning(null)}>{linkWarning}</Notice>
          )}

          {!loading && loadWarning && products.length > 0 && (
            <Notice level="warning" onDismiss={() => setLoadWarning(null)}>{loadWarning}</Notice>
          )}

          {!loading &&
            products.length > 0 &&
            platformNotices.map((notice, i) => (
              <Notice
                key={`${i}-${notice.message}`}
                level={notice.level}
                onDismiss={() => setPlatformNotices((prev) => prev.filter((n) => n !== notice))}
              >
                {notice.message}
              </Notice>
            ))}

          {!loading && !resolving && !autoLoadWaiting && !error && !infoNotice && products.length === 0 && (
            <div className="text-center py-20">
              <p className="text-muted-foreground text-lg">
                Enter a {supportedPlatformNames()} store or collection URL above to get started
              </p>
            </div>
          )}
          {!loading && products.length > 0 && (
            <ProductGrid
              products={filteredProducts}
              totalProducts={products.length}
              sortBy={sortBy}
              setSortBy={setSortBy}
              currency={filterData.currency}
            />
          )}
        </main>
      </div>
    </div>
  );
}
