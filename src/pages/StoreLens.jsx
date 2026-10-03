import React, { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, AlertCircle, Info, SlidersHorizontal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import ProductGrid from "../components/ProductGrid";

import {
  buildFilterSearch,
  computeFilterData,
  countActiveFilters,
  filterAndSortProducts,
  getCollectionJsonUrl,
  parseFilterParams,
} from "@/lib/filters";
import {
  discoverCollections,
  extractCollectionHandle,
  getDisplayHost,
  getOrigin,
  parseUserInputToURL,
} from "@/lib/store";

export default function StoreLensApp() {
  const [storeInput, setStoreInput] = useState("");
  const [storeOrigin, setStoreOrigin] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadNotice, setLoadNotice] = useState(null);
  const [urlHistory, setUrlHistory] = useState([]);
  const [collectionsState, setCollectionsState] = useState({
    status: "idle",
    collections: [],
    error: null,
    allProductsHandle: null,
  });
  const [selectedHandle, setSelectedHandle] = useState("");
  const [currentCollectionUrl, setCurrentCollectionUrl] = useState("");
  const [inputHandle, setInputHandle] = useState("");
  const [discoveryRetryNonce, setDiscoveryRetryNonce] = useState(0);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const forceRefreshDiscoveryRef = useRef(false);
  const autoLoadPendingRef = useRef(false);
  // Whether the CURRENTLY EXECUTING applyUserInput() call was triggered by
  // loadFromLocation (initial mount or Back/Forward) rather than a manual
  // action (paste, dropdown, history select). Set/cleared synchronously
  // bracketing that one call site, so it's only ever true during that call's
  // own synchronous portion - nothing else ever sets it, so there's no
  // staleness risk from an unrelated later call seeing it left on.
  const isUrlOriginatedRef = useRef(false);
  // Snapshot of the above, taken when a bare domain defers to an async
  // auto-load (autoLoadPendingRef) - the auto-load itself resolves later,
  // well after isUrlOriginatedRef has been cleared, so its origin has to be
  // captured here instead of re-read at that later point.
  const pendingAutoLoadIsUrlOriginatedRef = useRef(false);
  // Filter/sort state parsed from the URL's query string (by loadFromLocation),
  // waiting to be applied once a collection's own data has settled - see the
  // restore effect below for why it can't just be applied immediately.
  const pendingFilterParamsRef = useRef(null);
  const historyKey = "shopify-url-history";
  const updateHistoryEntry = (entry) => {
    if (!entry) return;
    setUrlHistory((prev) => {
      const updated = [entry, ...prev.filter((u) => u !== entry)].slice(0, 5);
      try {
        localStorage.setItem(historyKey, JSON.stringify(updated));
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
  const [inStockOnly, setInStockOnly] = useState(false);
  const [saleOnly, setSaleOnly] = useState(false);
  const [sortBy, setSortBy] = useState("title-asc");

  // Load URL history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(historyKey);
      if (saved) {
        setUrlHistory(JSON.parse(saved));
      }
    } catch {
      /* localStorage unavailable or history corrupted — ignore */
    }
  }, []);


  const getHostname = (url) => {
    try {
      const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
      return urlObj.hostname;
    } catch {
      return "";
    }
  };


  // Shopify's legacy /products.json pagination tops out at 1000 pages of up
  // to 250 items (250,000 products). Beyond that — or if a page request
  // fails partway through a very large collection — keep whatever was
  // already fetched instead of discarding it all on one bad request.
  const MAX_PRODUCT_PAGES = 1000;

  // Back/Forward can kick off a new load while a previous one is still
  // in-flight (rapid navigation) - without tracking which call is current,
  // an older, slower response could resolve after a newer one and clobber
  // it, leaving the UI showing one collection while the address bar (and
  // the rest of the app's state) points at another.
  const fetchCollectionAbortRef = useRef(null);

  // Set immediately before the one call site that resolves a bare domain to
  // its default collection (never for an explicit choice - dropdown, paste,
  // or a deep link that already names a handle) and consumed synchronously
  // at the very start of the matching fetchCollection call, so it's tied to
  // that one attempt and can't be left stale for an unrelated later load to
  // pick up. Read by the URL-sync effect to replaceState instead of
  // pushState for that one case - see lastLoadWasAutoDefaultRef below.
  const nextLoadIsAutoDefaultRef = useRef(false);
  const lastLoadWasAutoDefaultRef = useRef(false);

  const fetchCollection = async (url) => {
    fetchCollectionAbortRef.current?.abort();
    const controller = new AbortController();
    fetchCollectionAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted;
    const isAutoDefaultLoad = nextLoadIsAutoDefaultRef.current;
    nextLoadIsAutoDefaultRef.current = false;
    // Any load that isn't part of a URL-originated chain (isUrlOriginatedRef
    // covers an explicit handle in the URL; isAutoDefaultLoad covers a bare
    // domain's auto-resolved default, which resolves asynchronously after
    // isUrlOriginatedRef has already been cleared) supersedes whatever
    // pending URL-driven filters might still be waiting for a load that
    // failed or was itself superseded before it could consume them - a
    // manually chosen collection should never inherit someone else's
    // leftover filter state.
    if (!isUrlOriginatedRef.current && !isAutoDefaultLoad) {
      pendingFilterParamsRef.current = null;
    }

    setLoading(true);
    setError(null);
    setLoadNotice(null);
    setProducts([]);

    let jsonUrl;
    try {
      jsonUrl = getCollectionJsonUrl(url);
    } catch (err) {
      if (isCurrent()) {
        setError(err.message);
        setLoading(false);
      }
      return;
    }

    let allProducts = [];
    let page = 1;
    let hasMore = true;
    let pageError = null;

    while (hasMore && page <= MAX_PRODUCT_PAGES) {
      try {
        const response = await fetch(`${jsonUrl}?page=${page}&limit=250`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch page ${page} (status ${response.status})`);
        }
        const data = await response.json();
        if (data.products && data.products.length > 0) {
          // Push in place rather than spreading into a new array each page —
          // for a collection near the 1000-page cap, re-copying the whole
          // accumulated array on every iteration is O(n²).
          allProducts.push(...data.products);
          page++;
          hasMore = data.products.length === 250;
        } else {
          hasMore = false;
        }
      } catch (err) {
        if (!isCurrent()) return; // superseded - the newer call owns state from here
        pageError = err;
        hasMore = false;
      }
    }

    if (!isCurrent()) return;

    if (allProducts.length === 0) {
      setError(pageError?.message || "No products found in this collection");
      setLoading(false);
      return;
    }

    // Wrapped in finally: updateHistoryEntry writes to localStorage, which
    // can throw (quota exceeded, private browsing, storage blocked) — that
    // shouldn't leave the loading spinner stuck when products already loaded.
    try {
      setProducts(allProducts);
      setCurrentCollectionUrl(url);
      lastLoadWasAutoDefaultRef.current = isAutoDefaultLoad;
      resetFilters();

      if (pageError) {
        setLoadNotice(
          `Loaded ${allProducts.length.toLocaleString()} products, but couldn't fetch the rest (${pageError.message}).`
        );
      } else if (page > MAX_PRODUCT_PAGES && hasMore) {
        setLoadNotice(
          `This collection is larger than Shopify's public catalog can page through — showing the first ${allProducts.length.toLocaleString()} products.`
        );
      }

      if (collectionsState.status !== "ready") {
        // Domain only, never the collection path - a collection URL here
        // (raced ahead of discovery's own history write below) would
        // otherwise bump other domains out of Recent Stores every time
        // someone just browses collections within the same store.
        updateHistoryEntry(new URL(url).origin);
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
      }
    }
  };

  const loadCollectionByHandle = async (handle, origin = storeOrigin) => {
    if (!handle || !origin) {
      setError("Please select a collection to load.");
      return;
    }
    const url = `${origin}/collections/${handle}`;
    setSelectedHandle(handle);
    setInputHandle(handle);
    await fetchCollection(url);
  };

  // Called only from explicit, discrete actions (submit, paste, history
  // selection) — never on every keystroke — so it always resolves the input
  // immediately: normalizing the display to a clean host, kicking off
  // collection discovery, and loading a collection URL's handle right away.
  const applyUserInput = (value) => {
    const parsed = parseUserInputToURL(value);
    if (!parsed) {
      setStoreInput(value);
      setStoreOrigin("");
      setInputHandle("");
      setSelectedHandle("");
      // Only surface an error for genuinely invalid input — an empty
      // submission (e.g. pressing Enter on an empty box) isn't a mistake.
      if (value?.trim()) {
        setError("Please enter a valid Shopify store or collection URL");
      }
      return;
    }
    const origin = getOrigin(parsed);
    const host = getDisplayHost(parsed);
    const handle = extractCollectionHandle(parsed);
    setStoreInput(host);
    setStoreOrigin(origin);
    setInputHandle(handle || "");
    if (handle) {
      autoLoadPendingRef.current = false;
      loadCollectionByHandle(handle, origin);
    } else {
      // Bare domain: no collection path to load directly. Once discovery
      // resolves, auto-load its best guess (e.g. the store's all-products
      // collection) instead of leaving the user stuck on an empty page.
      setSelectedHandle("");
      setCurrentCollectionUrl("");
      autoLoadPendingRef.current = true;
      pendingAutoLoadIsUrlOriginatedRef.current = isUrlOriginatedRef.current;
    }
    setDiscoveryRetryNonce((n) => n + 1);
  };

  const handleSubmitStoreInput = () => {
    setError(null);
    applyUserInput(storeInput);
  };

  // Deep link support: /<domain> or /<domain>/collections/<handle> in the
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
    isUrlOriginatedRef.current = true;
    try {
      if (path) {
        pendingFilterParamsRef.current = parseFilterParams(window.location.search);
        applyUserInput(path);
      } else {
        // Cancel whatever collection request might still be in flight -
        // otherwise a slow one can resolve after landing here, repopulating
        // products/currentCollectionUrl and pushing a stale URL right back
        // onto history even though the user navigated back to empty.
        fetchCollectionAbortRef.current?.abort();
        pendingFilterParamsRef.current = null;
        setLoading(false);
        setProducts([]);
        setCurrentCollectionUrl("");
        setError(null);
        setLoadNotice(null);
        applyUserInput("");
      }
    } finally {
      isUrlOriginatedRef.current = false;
    }
  };

  useEffect(() => {
    loadFromLocation();
    window.addEventListener("popstate", loadFromLocation);
    return () => window.removeEventListener("popstate", loadFromLocation);
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
  // The one exception: a bare domain resolving to its store's default
  // collection is an auto-resolved implicit guess, not a deliberate choice -
  // pushing it would mean Back from it lands on the bare-domain entry, which
  // immediately re-resolves and re-pushes the very same URL, truncating the
  // forward stack and trapping Back/Forward in a loop. replaceState instead
  // normalizes the bare entry to its explicit URL in place, so it never
  // exists ambiguously in history to begin with.
  useEffect(() => {
    if (!currentCollectionUrl) return;
    const loaded = new URL(currentCollectionUrl);
    const path = `/${loaded.host}${loaded.pathname}`;
    // loaded.host is always lowercased by the URL API, but the domain
    // segment of window.location.pathname (just a path segment here, not a
    // real host) keeps whatever case the link used - lowercase only that
    // first segment before comparing, so a mixed-case deep link doesn't look
    // like a "change" and push a spurious duplicate entry for what's already
    // the same page.
    const normalizedCurrentPath = window.location.pathname.replace(/^\/[^/]+/, (domain) => domain.toLowerCase());
    if (path !== normalizedCurrentPath) {
      if (lastLoadWasAutoDefaultRef.current) {
        window.history.replaceState(null, "", path);
      } else {
        window.history.pushState(null, "", path);
      }
    }
  }, [currentCollectionUrl]);

  // Set default filter values
  const resetFilters = () => {
    setSearchQuery("");
    setSelectedVendors([]);
    setSelectedTypes([]);
    setSelectedTags([]);
    setSelectedOptions({});
    setInStockOnly(true);
    setSaleOnly(false);
  };

  // Discovery only ever runs from a discrete user action (submit, paste,
  // history selection, retry) now — never from continuous typing — so there's
  // no keystroke burst to debounce against; this runs as soon as storeOrigin
  // or discoveryRetryNonce changes.
  useEffect(() => {
    if (!storeOrigin) {
      setCollectionsState({
        status: "idle",
        collections: [],
        error: null,
        allProductsHandle: null,
      });
      return;
    }

    const controller = new AbortController();
    (async () => {
      setCollectionsState((prev) => ({
        ...prev,
        status: "loading",
        error: null,
      }));
      const forceRefresh = forceRefreshDiscoveryRef.current;
      forceRefreshDiscoveryRef.current = false;
      try {
        const { collections, allProductsHandle } = await discoverCollections(
          storeOrigin,
          controller.signal,
          { forceRefresh }
        );
        if (!controller.signal.aborted) {
          setCollectionsState({
            status: "ready",
            collections,
            error: null,
            allProductsHandle,
          });
          updateHistoryEntry(storeOrigin);
          // Consume the flag here, against this exact discovery's fresh
          // result, rather than in a separate effect watching collectionsState:
          // that raced against a stale "ready" state left over from whichever
          // store was discovered previously, firing before this discovery
          // resolved and consuming the flag before it had real data to use.
          if (autoLoadPendingRef.current) {
            autoLoadPendingRef.current = false;
            if (allProductsHandle) {
              // Only replaceState (below, via lastLoadWasAutoDefaultRef) when
              // this bare domain itself came from the URL/Back-Forward - a
              // manually submitted bare domain (paste, history select) should
              // still push, so Back can return to whatever was loaded before.
              nextLoadIsAutoDefaultRef.current = pendingAutoLoadIsUrlOriginatedRef.current;
              loadCollectionByHandle(allProductsHandle, storeOrigin);
            } else {
              setError(
                "I couldn't automatically find an all-products collection for this store. Please choose a collection from the dropdown above."
              );
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setCollectionsState({
            status: "error",
            collections: [],
            error: err.message || "Couldn't load collections for this store",
            allProductsHandle: null,
          });
          if (autoLoadPendingRef.current) {
            autoLoadPendingRef.current = false;
            setError(
              "I couldn't find a collection of products to load. Please paste the full collection URL and try again."
            );
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
    setDiscoveryRetryNonce((n) => n + 1);
  };

  // Keep the currently-loaded collection selectable in the dropdown even when
  // /collections.json (and the all-products probe) didn't happen to include
  // it — otherwise the Select ends up holding a value with no matching item.
  useEffect(() => {
    if (collectionsState.status !== "ready" || !inputHandle) return;
    setSelectedHandle(inputHandle);
    setCollectionsState((prev) => {
      if (prev.collections.some((c) => c.handle === inputHandle)) return prev;
      const title = inputHandle
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        ...prev,
        collections: [{ handle: inputHandle, title, products_count: null }, ...prev.collections],
      };
    });
  }, [collectionsState, inputHandle]);

  const handleInputChange = (value) => {
    // Just track what's typed; parsing the URL and kicking off collection
    // discovery on every keystroke re-rendered the whole app (including a
    // potentially large product grid), making typing feel sluggish. Actually
    // resolving the input now happens on submit (Enter or the Load button).
    setError(null);
    setStoreInput(value);
  };

  const handlePaste = (value) => {
    setError(null);
    applyUserInput(value);
  };

  const handleSelectHistory = (url) => {
    applyUserInput(url);
  };

  const handleSelectHandle = (handle) => {
    setError(null);
    setSelectedHandle(handle);
    setInputHandle(handle);
    loadCollectionByHandle(handle, storeOrigin);
  };

  // Extract unique filter values
  const filterData = useMemo(() => computeFilterData(products), [products]);

  // Count of active filter groups (not total selected values within a group) -
  // shared between the mobile "Filters" toggle button's badge and Sidebar's
  // own Reset button, so the two stay in sync rather than each computing
  // "active" from a possibly-diverging copy of the same conditions.
  const activeFilterCount = useMemo(
    () => countActiveFilters(
      { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange },
      filterData
    ),
    [searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange, filterData]
  );

  // Update price range when products change
  useEffect(() => {
    if (filterData.minPrice !== Infinity && filterData.maxPrice !== 0) {
      setPriceRange([filterData.minPrice, filterData.maxPrice]);
    }
  }, [filterData]);

  // Restore filter/sort state from the URL once a collection's own data has
  // settled - both resetFilters() (called on every successful load) and the
  // price-range effect above would otherwise immediately overwrite it with
  // defaults. Keyed on currentCollectionUrl (changes exactly once per
  // successful load) rather than filterData/products directly, since those
  // also transiently reset to empty at the START of a load, before the real
  // data arrives - reacting to that would apply these against the wrong
  // (empty) filterData and consume the pending params before the real
  // filterData was ever available to restore against.
  useEffect(() => {
    const pending = pendingFilterParamsRef.current;
    if (!pending || !currentCollectionUrl) return;
    pendingFilterParamsRef.current = null;
    if (pending.searchQuery !== undefined) setSearchQuery(pending.searchQuery);
    if (pending.selectedVendors !== undefined) setSelectedVendors(pending.selectedVendors);
    if (pending.selectedTypes !== undefined) setSelectedTypes(pending.selectedTypes);
    if (pending.selectedTags !== undefined) setSelectedTags(pending.selectedTags);
    if (pending.selectedOptions !== undefined) setSelectedOptions(pending.selectedOptions);
    if (pending.inStockOnly !== undefined) setInStockOnly(pending.inStockOnly);
    if (pending.saleOnly !== undefined) setSaleOnly(pending.saleOnly);
    if (pending.priceRange !== undefined) setPriceRange(pending.priceRange);
    if (pending.sortBy !== undefined) setSortBy(pending.sortBy);
  }, [currentCollectionUrl]);

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
  useEffect(() => {
    if (!currentCollectionUrl) return;
    const timeoutId = setTimeout(() => {
      const newSearch = buildFilterSearch(
        { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange, sortBy },
        filterData
      );
      if (newSearch !== window.location.search) {
        window.history.replaceState(null, "", window.location.pathname + newSearch);
      }
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [
    currentCollectionUrl,
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
  ]);

  // Filter products
  const filteredProducts = useMemo(
    () => filterAndSortProducts(products, {
      searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions,
      priceRange, inStockOnly, saleOnly, sortBy,
    }),
    [products, searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, priceRange, inStockOnly, saleOnly, sortBy]
  );

  return (
    <div className="min-h-screen bg-secondary">
      <Header
        storeInput={storeInput}
        onStoreInputChange={handleInputChange}
        onStorePaste={handlePaste}
        onLoad={handleSubmitStoreInput}
        loading={loading}
        urlHistory={urlHistory}
        onSelectHistory={handleSelectHistory}
        collections={collectionsState.collections}
        collectionsStatus={collectionsState.status}
        collectionsError={collectionsState.error}
        selectedHandle={selectedHandle}
        onSelectHandle={handleSelectHandle}
        onRetryCollections={handleRetryDiscovery}
      />

      <div className="flex">
        {products.length > 0 && (
          <Sidebar
            filterData={filterData}
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

        <main className="flex-1 p-4 sm:p-6 bg-background border-sidebar-border border-l">
          {!loading && products.length > 0 && (
            <Button
              variant="outline"
              className="mb-4 xl:hidden"
              onClick={() => setIsFilterDrawerOpen(true)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </Button>
          )}

          {loading && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <Alert variant="destructive" className="max-w-2xl mx-auto">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!loading && loadNotice && products.length > 0 && (
            <Alert className="max-w-2xl mx-auto mb-6">
              <Info className="h-4 w-4" />
              <AlertDescription>{loadNotice}</AlertDescription>
            </Alert>
          )}

          {!loading && !error && products.length === 0 && (
            <div className="text-center py-20">
              <p className="text-muted-foreground text-lg">
                Enter a Shopify store or collection URL above to get started
              </p>
            </div>
          )}
          {!loading && products.length > 0 && (
            <ProductGrid
              products={filteredProducts}
              totalProducts={products.length}
              sortBy={sortBy}
              setSortBy={setSortBy}
              collectionUrl={getHostname(currentCollectionUrl)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
