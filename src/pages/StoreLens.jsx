import React, { useState, useEffect, useMemo } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

import Header from "../components/Header";
import Sidebar from "../components/Sidebar";
import ProductGrid from "../components/ProductGrid";

import { getDiscountData } from "@/lib/utils";

export default function StoreLensApp() {
  const [collectionUrl, setCollectionUrl] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [urlHistory, setUrlHistory] = useState([]);
  
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
    const saved = localStorage.getItem("shopify-url-history");
    if (saved) {
      setUrlHistory(JSON.parse(saved));
    }
  }, []);

  // Check if URL is a bare domain (no collection path)
  const isBareDomain = (url) => {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      const pathname = urlObj.pathname;
      return !pathname || pathname === '/' || pathname === '';
    } catch {
      return false;
    }
  };

  // Convert to bare hostname (for product links)
  const getHostname = (url) => {
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      return urlObj.hostname;
    } catch {
      return false;
    }
  };

  // Resolve default collection for a bare domain
  const resolveDefaultCollection = async (baseUrl) => {
    const urlObj = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
    const domain = `${urlObj.protocol}//${urlObj.host}`;
    
    const candidates = [
      'all',
      'all-1', 
      'all-products',
    ];

    for (const candidate of candidates) {
      try {
        const testUrl = `${domain}/collections/${candidate}/products.json?limit=1`;
        const response = await fetch(testUrl);
        
        if (response.ok) {
          const data = await response.json();
          if (data.products && data.products.length > 0) {
            return `${domain}/collections/${candidate}`;
          }
        }
      } catch (err) {
        continue;
      }
    }

    return null;
  };

  // Convert Shopify collection URL to JSON endpoint
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
    } catch (err) {
      throw new Error("Please enter a valid Shopify collection URL");
    }
  };

  // Fetch all products with pagination
  const fetchCollection = async (url) => {
    setLoading(true);
    setError(null);
    setProducts([]);
    
    try {
      let resolvedUrl = url;
      
      // If it's a bare domain, try to resolve to default collection
      if (isBareDomain(url)) {
        const defaultCollection = await resolveDefaultCollection(url);
        if (!defaultCollection) {
          throw new Error("I couldn't find a collection of products to load. Please paste the full collection URL and try again.");
        }
        resolvedUrl = defaultCollection;
      }
      
      const jsonUrl = getJsonUrl(resolvedUrl);
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
      
      // Update URL history with the original input
      const newHistory = [url, ...urlHistory.filter(u => u !== url)].slice(0, 5);
      setUrlHistory(newHistory);
      localStorage.setItem("shopify-url-history", JSON.stringify(newHistory));
      
      // Reset filters
      resetFilters();
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadCollection = () => {
    if (collectionUrl.trim()) {
      fetchCollection(collectionUrl.trim());
    }
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
          return a.title.localeCompare(b.title);
        case "title-desc":
          return b.title.localeCompare(a.title);
        case "price-asc": {
          const aMin = Math.min(...a.variants.map(v => parseFloat(v.price)));
          const bMin = Math.min(...b.variants.map(v => parseFloat(v.price)));
          return aMin - bMin;
        }
        case "price-desc": {
          const aMax = Math.max(...a.variants.map(v => parseFloat(v.price)));
          const bMax = Math.max(...b.variants.map(v => parseFloat(v.price)));
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
        collectionUrl={collectionUrl}
        setCollectionUrl={setCollectionUrl}
        onLoad={handleLoadCollection}
        loading={loading}
        urlHistory={urlHistory}
        onSelectHistory={(url) => {
          setCollectionUrl(url);
          fetchCollection(url);
        }}
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
                Enter a Shopify collection URL above to get started
              </p>
            </div>
          )}
          {/* <h2 className="text-center text-white text-lg">{new URL(collectionUrl).hostname}</h2> */}

          {!loading && products.length > 0 && (
            <ProductGrid
              products={filteredProducts}
              totalProducts={products.length}
              sortBy={sortBy}
              setSortBy={setSortBy}
              collectionUrl={getHostname(collectionUrl)}
            />
          )}
        </main>
      </div>
    </div>
  );
}