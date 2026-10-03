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

// Option names are compared ignoring case and surrounding whitespace, so
// "Size" and "size " are one filter. Different names ("Waist size") are never
// merged.
export function normalizeOptionName(name) {
  return String(name ?? "").trim().toLowerCase();
}

export function computeFilterData(products) {
  const vendors = new Set();
  const types = new Set();
  const tags = new Set();
  // normalized name -> { name, values, productCount }, in first-seen order
  const optionGroups = new Map();
  let currency;
  let minPrice = Infinity;
  let maxPrice = 0;

  products.forEach(product => {
    product.vendors?.forEach(vendor => vendors.add(vendor));
    product.categories?.forEach(category => types.add(category));
    product.tags?.forEach(tag => tags.add(tag));
    currency ??= product.currency;

    // Variant options are grouped by the option's name, wherever it sits in
    // each product's option list, so every "Size" ends up in one filter.
    product.options?.forEach((option, index) => {
      const key = normalizeOptionName(option.name);
      if (!key) return;
      const values = new Set();
      product.variants?.forEach(variant => {
        const value = variant.options?.[index];
        if (value) values.add(value);
      });
      if (values.size === 0) return;
      const group = optionGroups.get(key) ?? { casings: new Map(), values: new Set(), productCount: 0 };
      const casing = String(option.name).trim();
      group.casings.set(casing, (group.casings.get(casing) ?? 0) + 1);
      values.forEach(value => group.values.add(value));
      group.productCount += 1;
      optionGroups.set(key, group);
    });

    product.variants?.forEach(variant => {
      const price = variant.price;
      if (price < minPrice) minPrice = price;
      if (price > maxPrice) maxPrice = price;
    });
  });

  // Options that more products have come first (so Size and Color lead);
  // ties keep first-seen order. The label doubles as the key used in state
  // and in the URL (?options={"Size":["S"]}).
  const optionsArray = [...optionGroups.values()]
    .sort((a, b) => b.productCount - a.productCount)
    .map(({ casings, values }) => {
      // Stores sometimes mix casings ("Color" and "color"); label the group
      // with the most common one, first-seen on a tie.
      const name = [...casings.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
      return { name, key: name, values: Array.from(values).sort() };
    });

  return {
    vendors: Array.from(vendors).sort(),
    types: Array.from(types).sort(),
    tags: Array.from(tags).sort(),
    options: optionsArray,
    currency,
    minPrice: minPrice === Infinity ? 0 : Math.floor(minPrice),
    maxPrice: maxPrice === 0 ? 1000 : Math.ceil(maxPrice)
  };
}

// Links shared before options were keyed by name carry ?options={"option1":
// [...]}. option1 was labelled with the first product's first option name, so
// that is the name it maps to; if that product has no such option (e.g. it
// only had the dropped Title placeholder) the first product that does decides.
// Keys are also matched to the filter's own label case-insensitively. Anything
// that matches no option is kept as is.
export function canonicalizeOptionKeys(selectedOptions, products, filterOptions) {
  const labels = new Map(filterOptions.map(option => [normalizeOptionName(option.name), option.name]));
  const result = {};
  Object.entries(selectedOptions).forEach(([rawKey, values]) => {
    const legacy = /^option([1-3])$/.exec(rawKey);
    const position = legacy ? Number(legacy[1]) - 1 : -1;
    const name = legacy
      ? products.find(p => p.options?.[position])?.options[position].name ?? rawKey
      : rawKey;
    const key = labels.get(normalizeOptionName(name)) ?? name;
    result[key] = [...new Set([...(result[key] ?? []), ...values])];
  });
  return result;
}

// Selections for filters a platform can't populate (capabilities.* === false)
// are ignored everywhere: a deep link carrying ?vendor=... must not filter a
// catalog whose vendor control is hidden. Capabilities default to supported.
function withoutUnsupportedSelections(state, capabilities = {}) {
  return {
    ...state,
    selectedVendors: capabilities.vendors === false ? [] : state.selectedVendors,
    selectedTypes: capabilities.categories === false ? [] : state.selectedTypes,
    selectedTags: capabilities.tags === false ? [] : state.selectedTags,
    selectedOptions: capabilities.variantOptions === false ? {} : state.selectedOptions,
  };
}

export function countActiveFilters(state, filterData, capabilities = {}) {
  const {
    searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, saleOnly, priceRange,
  } = withoutUnsupportedSelections(state, capabilities);
  // A platform without stock data hides the checkbox, so it reads as the
  // default (on) rather than as an active filter.
  const inStockOnly = capabilities.variantStock === false ? true : state.inStockOnly;
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

export function filterAndSortProducts(products, state, capabilities = {}) {
  const {
    searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, priceRange, saleOnly, sortBy,
  } = withoutUnsupportedSelections(state, capabilities);
  // Without stock data nothing can be filtered by it.
  const inStockOnly = capabilities.variantStock === false ? false : state.inStockOnly;
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

  // Options (sizes, colors, etc), matched by option name
  Object.entries(selectedOptions).forEach(([optionName, values]) => {
    if (values.length > 0) {
      const target = normalizeOptionName(optionName);
      filtered = filtered.filter(p => {
        // A product without this option can't match it.
        const index = p.options?.findIndex(o => normalizeOptionName(o.name) === target) ?? -1;
        return index >= 0 && p.variants?.some(v => values.includes(v.options?.[index]));
      });
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

export function buildFilterSearch(state, filterData, capabilities = {}) {
  const {
    searchQuery, selectedVendors, selectedTypes, selectedTags, selectedOptions, saleOnly, priceRange, sortBy,
  } = withoutUnsupportedSelections(state, capabilities);
  const inStockOnly = capabilities.variantStock === false ? true : state.inStockOnly;
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
