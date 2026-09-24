import React, { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import ProductGrid from "../components/ProductGrid";

import { getDiscountData } from "@/lib/utils";
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
  const forceRefreshDiscoveryRef = useRef(false);
  const autoLoadPendingRef = useRef(false);
  const historyKey = "shopify-url-history";
  const updateHistoryEntry = (entry) => {
    if (!entry) return;
    setUrlHistory((prev) => {
      const updated = [entry, ...prev.filter((u) => u !== entry)].slice(0, 5);
      localStorage.setItem(historyKey, JSON.stringify(updated));
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
    const saved = localStorage.getItem(historyKey);
    if (saved) {
      setUrlHistory(JSON.parse(saved));
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

  const getJsonUrl = (url) => {
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
  };

  const fetchCollection = async (url) => {
    setLoading(true);
    setError(null);
    setProducts([]);
    
    try {
      const jsonUrl = getJsonUrl(url);
      let allProducts = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await fetch(`${jsonUrl}?page=${page}&limit=250`);
        if (!response.ok) throw new Error("Failed to fetch collection");
        
        const data = await response.json();
        
        if (data.products && data.products.length > 0) {
          allProducts = [...allProducts, ...data.products];
          page++;
          hasMore = data.products.length === 250;
        } else {
          hasMore = false;
        }
      }

      if (allProducts.length === 0) {
        throw new Error("No products found in this collection");
      }

    setProducts(allProducts);
    setCurrentCollectionUrl(url);
    resetFilters();
    setError(null);
    if (collectionsState.status !== "ready") {
      updateHistoryEntry(url);
    }
  } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
    }
    setDiscoveryRetryNonce((n) => n + 1);
  };

  const handleSubmitStoreInput = () => {
    setError(null);
    applyUserInput(storeInput);
  };

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
  const filterData = useMemo(() => {
    const vendors = new Set();
    const types = new Set();
    const tags = new Set();
    const options = {};
    let minPrice = Infinity;
    let maxPrice = 0;

    products.forEach(product => {
      if (product.vendor) vendors.add(product.vendor);
      if (product.product_type) types.add(product.product_type);
      if (product.tags) {
        product.tags.forEach(tag => tags.add(tag));
      }

      // Extract variant options
      product.variants?.forEach(variant => {
        variant.option1 && !options["option1"] && (options["option1"] = new Set());
        variant.option2 && !options["option2"] && (options["option2"] = new Set());
        variant.option3 && !options["option3"] && (options["option3"] = new Set());
        
        variant.option1 && options["option1"].add(variant.option1);
        variant.option2 && options["option2"].add(variant.option2);
        variant.option3 && options["option3"].add(variant.option3);

        const price = parseFloat(variant.price);
        if (price < minPrice) minPrice = price;
        if (price > maxPrice) maxPrice = price;
      });
    });

    // Convert Sets to sorted arrays
    const optionsArray = Object.entries(options).map(([key, values]) => ({
      name: products[0]?.options?.find((_, i) => `option${i + 1}` === key)?.name || key,
      key,
      values: Array.from(values).sort()
    }));

    return {
      vendors: Array.from(vendors).sort(),
      types: Array.from(types).sort(),
      tags: Array.from(tags).sort(),
      options: optionsArray,
      minPrice: minPrice === Infinity ? 0 : Math.floor(minPrice),
      maxPrice: maxPrice === 0 ? 1000 : Math.ceil(maxPrice)
    };
  }, [products]);

  // Update price range when products change
  useEffect(() => {
    if (filterData.minPrice !== Infinity && filterData.maxPrice !== 0) {
      setPriceRange([filterData.minPrice, filterData.maxPrice]);
    }
  }, [filterData]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let filtered = [...products];

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p => 
        p.title?.toLowerCase().includes(query) ||
        p.body_html?.toLowerCase().includes(query)
      );
    }

    // Vendors
    if (selectedVendors.length > 0) {
      filtered = filtered.filter(p => selectedVendors.includes(p.vendor));
    }

    // Types
    if (selectedTypes.length > 0) {
      filtered = filtered.filter(p => selectedTypes.includes(p.product_type));
    }

    // Tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter(p => 
        selectedTags.some(tag => p.tags?.includes(tag))
      );
    }

    // Options (sizes, colors, etc)
    Object.entries(selectedOptions).forEach(([optionKey, values]) => {
      if (values.length > 0) {
        filtered = filtered.filter(p =>
          p.variants?.some(v => values.includes(v[optionKey]))
        );
      }
    });

    // Price range
    filtered = filtered.filter(p => {
      const prices = p.variants?.map(v => parseFloat(v.price)) || [];
      const minProductPrice = Math.min(...prices);
      const maxProductPrice = Math.max(...prices);
      return maxProductPrice >= priceRange[0] && minProductPrice <= priceRange[1];
    });

    // In stock only
    if (inStockOnly) {
      filtered = filtered.filter(p =>
        p.variants?.some(v => v.available)
      );
    }

    // Sale only
    if (saleOnly) {
      filtered = filtered.filter(p => {
        const { hasDiscount } = getDiscountData(p.variants || []);
        return hasDiscount;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "title-asc":
          return (a.title || "").localeCompare(b.title || "");
        case "title-desc":
          return (b.title || "").localeCompare(a.title || "");
        case "price-asc": {
          const aMin = Math.min(...(a.variants || []).map(v => parseFloat(v.price)), Infinity);
          const bMin = Math.min(...(b.variants || []).map(v => parseFloat(v.price)), Infinity);
          return aMin - bMin;
        }
        case "price-desc": {
          const aMax = Math.max(...(a.variants || []).map(v => parseFloat(v.price)), -Infinity);
          const bMax = Math.max(...(b.variants || []).map(v => parseFloat(v.price)), -Infinity);
          return bMax - aMax;
        }
        case "newest":
          return new Date(b.created_at) - new Date(a.created_at);
        case "discount-percent":
          return (
            getDiscountData(b.variants || []).discountPercent -
            getDiscountData(a.variants || []).discountPercent
          );
        case "discount-amount":
          return (
            getDiscountData(b.variants || []).discountAmount -
            getDiscountData(a.variants || []).discountAmount
          );
        default:
          return 0;
      }
    });

    return filtered;
  }, [products, searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, priceRange, inStockOnly, saleOnly, sortBy]);

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
          />
        )}

        <main className="flex-1 p-6 bg-background border-sidebar-border border-l">
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
