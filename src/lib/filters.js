import { getDiscountData } from "@/lib/utils";

// Pure filter/sort/URL-param logic over the platform-neutral product shape
// (see platforms/types.js), kept out of the page component so it can be unit
// tested without rendering it.

// Parses filter/sort state out of the URL's query string (?q=...&vendor=a,b&...).
// Returns null when there's nothing to restore, so callers can tell "no
// params" apart from "params that happen to match the defaults".
export function parseFilterParams(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].length === 0) return null;

  const result = {};
  if (params.has("q")) result.searchQuery = params.get("q");
  if (params.has("vendor")) result.selectedVendors = params.getAll("vendor").filter(Boolean);
  if (params.has("type")) result.selectedTypes = params.getAll("type").filter(Boolean);
  if (params.has("tag")) result.selectedTags = params.getAll("tag").filter(Boolean);
  if (params.has("options")) {
    try {
      const parsed = JSON.parse(params.get("options"));
      // JSON.parse accepts plenty of shapes that aren't the {key: [values]}
      // object selectedOptions requires (null, arrays, primitives, or an
      // object with non-array values) - Object.keys/entries on those either
      // throws or silently corrupts filtering, so validate the shape rather
      // than just checking JSON.parse didn't throw.
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every((v) => Array.isArray(v))
      ) {
        result.selectedOptions = parsed;
      }
    } catch {
      /* malformed options param - ignore rather than crash */
    }
  }
  if (params.has("inStock")) result.inStockOnly = params.get("inStock") !== "0";
  if (params.has("sale")) result.saleOnly = params.get("sale") === "1";
  if (params.has("minPrice") && params.has("maxPrice")) {
    const min = Number(params.get("minPrice"));
    const max = Number(params.get("maxPrice"));
    // Number.isFinite (not just !isNaN) rejects Infinity/-Infinity too - a
    // link like ?minPrice=Infinity&maxPrice=Infinity parses without error
    // but then fails every product's price check, silently filtering out
    // the entire collection. Also reject an inverted range (min > max),
    // which would do the same.
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      result.priceRange = [min, max];
    }
  }
  if (params.has("sort")) result.sortBy = params.get("sort");

  return Object.keys(result).length > 0 ? result : null;
}

export function computeFilterData(products) {
  const vendors = new Set();
  const types = new Set();
  const tags = new Set();
  const options = {};
  let minPrice = Infinity;
  let maxPrice = 0;

  products.forEach(product => {
    product.vendors?.forEach(vendor => vendors.add(vendor));
    product.categories?.forEach(category => types.add(category));
    product.tags?.forEach(tag => tags.add(tag));

    // Extract variant options. Filters are keyed by position (option1,
    // option2, ...) for now; name-keyed options are tracked in #27.
    product.variants?.forEach(variant => {
      variant.options?.forEach((value, index) => {
        if (!value) return;
        const key = `option${index + 1}`;
        (options[key] ||= new Set()).add(value);
      });

      const price = variant.price;
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
    });
  });

  // Convert Sets to sorted arrays
  const optionsArray = Object.entries(options).map(([key, values]) => ({
    name: products[0]?.options?.[Number(key.slice("option".length)) - 1]?.name || key,
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
}

export function countActiveFilters(
  { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange },
  filterData
) {
  let count = 0;
  if (searchQuery) count++;
  if (selectedVendors.length > 0) count++;
  if (selectedTypes.length > 0) count++;
  if (selectedTags.length > 0) count++;
  if (Object.values(selectedOptions).some((v) => v.length > 0)) count++;
  if (!inStockOnly) count++;
  if (saleOnly) count++;
  if (priceRange[0] !== filterData.minPrice || priceRange[1] !== filterData.maxPrice) count++;
  return count;
}

// Option filters are keyed option1..option3 (position in the variant's
// options). Any other key matches nothing.
function variantOptionValue(variant, optionKey) {
  const match = /^option([1-3])$/.exec(optionKey);
  return match ? variant.options?.[Number(match[1]) - 1] : undefined;
}

export function filterAndSortProducts(
  products,
  { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, priceRange, inStockOnly, saleOnly, sortBy }
) {
  let filtered = [...products];

  // Search
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(p => 
      p.title?.toLowerCase().includes(query) ||
      p.description?.toLowerCase().includes(query)
    );
  }

  // Vendors
  if (selectedVendors.length > 0) {
    filtered = filtered.filter(p => p.vendors?.some(v => selectedVendors.includes(v)));
  }

  // Types
  if (selectedTypes.length > 0) {
    filtered = filtered.filter(p => p.categories?.some(c => selectedTypes.includes(c)));
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
        p.variants?.some(v => values.includes(variantOptionValue(v, optionKey)))
      );
    }
  });

  // Price range
  filtered = filtered.filter(p => {
    const prices = p.variants?.map(v => v.price) || [];
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
        const aMin = Math.min(...(a.variants || []).map(v => v.price), Infinity);
        const bMin = Math.min(...(b.variants || []).map(v => v.price), Infinity);
        return aMin - bMin;
      }
      case "price-desc": {
        const aMax = Math.max(...(a.variants || []).map(v => v.price), -Infinity);
        const bMax = Math.max(...(b.variants || []).map(v => v.price), -Infinity);
        return bMax - aMax;
      }
      case "newest":
        return new Date(b.createdAt) - new Date(a.createdAt);
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
}

export function buildFilterSearch(
  { searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, inStockOnly, saleOnly, priceRange, sortBy },
  filterData
) {
  const params = new URLSearchParams();
  if (searchQuery) params.set("q", searchQuery);
  // Repeated params rather than a comma-joined string - a vendor/type/tag
  // value containing a literal comma (e.g. "Acme, Inc.") would otherwise
  // get split back into multiple values on read, silently changing the
  // filter.
  selectedVendors.forEach((v) => params.append("vendor", v));
  selectedTypes.forEach((t) => params.append("type", t));
  selectedTags.forEach((t) => params.append("tag", t));
  if (Object.keys(selectedOptions).length > 0) params.set("options", JSON.stringify(selectedOptions));
  if (!inStockOnly) params.set("inStock", "0");
  if (saleOnly) params.set("sale", "1");
  if (priceRange[0] !== filterData.minPrice || priceRange[1] !== filterData.maxPrice) {
    params.set("minPrice", String(priceRange[0]));
    params.set("maxPrice", String(priceRange[1]));
  }
  if (sortBy !== "title-asc") params.set("sort", sortBy);

  const search = params.toString();
  const newSearch = search ? `?${search}` : "";
  return newSearch;
}
