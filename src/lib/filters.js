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

// Option values are compared the same way: "Tall", "tall" and " Tall " are one
// value.
export function normalizeOptionValue(value) {
  return normalizeOptionName(value);
}

const startsUppercase = (text) => text.charAt(0) !== text.charAt(0).toLowerCase();

// Picks how to show a name or value that stores spell several ways. A casing
// that starts with a capital wins over one that doesn't ("Tall" over "tall");
// among those, the most common wins, first-seen on a tie.
function pickCasing(counts) {
  const entries = [...counts.entries()];
  const capitalised = entries.filter(([casing]) => startsUppercase(casing));
  const pool = capitalised.length > 0 ? capitalised : entries;
  return pool.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

function countCasing(counts, casing) {
  counts.set(casing, (counts.get(casing) ?? 0) + 1);
}

export function computeFilterData(products) {
  const vendors = new Set();
  const types = new Set();
  const tags = new Set();
  // normalized name -> { casings, values, productCount }, in first-seen order;
  // values: normalized value -> casing counts
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
      const seen = [];
      product.variants?.forEach(variant => {
        const value = variant.options?.[index];
        if (value && normalizeOptionValue(value)) seen.push(String(value).trim());
      });
      if (seen.length === 0) return;
      const group = optionGroups.get(key) ?? { casings: new Map(), values: new Map(), productCount: 0 };
      countCasing(group.casings, String(option.name).trim());
      seen.forEach(value => {
        const valueKey = normalizeOptionValue(value);
        if (!group.values.has(valueKey)) group.values.set(valueKey, new Map());
        countCasing(group.values.get(valueKey), value);
      });
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
  // ties keep first-seen order. Stores spell the same name and value several
  // ways ("Color"/"color", "Tall"/"tall"), so each is shown once, in its
  // preferred casing (a capitalised spelling wins, but nothing is re-cased, so
  // "iPhone" stays "iPhone"). The label doubles
  // as the key used in state and in the URL (?options={"Size":["S"]}).
  const optionsArray = [...optionGroups.values()]
    .sort((a, b) => b.productCount - a.productCount)
    .map(({ casings, values }) => {
      const name = pickCasing(casings);
      const displayValues = [...values.values()].map(pickCasing).sort();
      return { name, key: name, values: displayValues };
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

// Matches option selections read from a link to this collection's own filters.
// Names and values are compared ignoring case and surrounding whitespace and
// come back in the filter's spelling. Only the parts that fit this collection
// are applied: an option it doesn't have (a stale or hand-edited link, or an
// old positional ?options={"option1":...} link) and a value the option doesn't
// have can't filter anything, so they are dropped and reported in `ignored`
// ("Material", "Size: Gigantic") rather than emptying the list.
export function restoreOptionSelections(selectedOptions, filterOptions) {
  const byName = new Map(
    filterOptions.map(option => [
      normalizeOptionName(option.name),
      {
        key: option.key,
        values: new Map(option.values.map(value => [normalizeOptionValue(value), value])),
      },
    ])
  );
  const options = {};
  const ignored = [];
  Object.entries(selectedOptions).forEach(([name, values]) => {
    const match = byName.get(normalizeOptionName(name));
    if (!match) {
      // A name with nothing selected isn't a filter, so there's nothing to warn about.
      if (values.length > 0) ignored.push(name);
      return;
    }
    const known = [];
    values.forEach(value => {
      const canonical = match.values.get(normalizeOptionValue(value));
      if (canonical === undefined) ignored.push(`${match.key}: ${value}`);
      else known.push(canonical);
    });
    // An option left with no applicable values isn't a filter at all.
    if (known.length > 0) {
      options[match.key] = [...new Set([...(options[match.key] ?? []), ...known])];
    }
  });
  return { options, ignored };
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
      const wanted = new Set(values.map(normalizeOptionValue));
      filtered = filtered.filter(p => {
        // A product without this option can't match it.
        const index = p.options?.findIndex(o => normalizeOptionName(o.name) === target) ?? -1;
        return index >= 0 && p.variants?.some(v => {
          const value = v.options?.[index];
          return value != null && wanted.has(normalizeOptionValue(value));
        });
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
  // Options with nothing selected (e.g. a filter ticked then cleared) don't belong in the URL.
  const activeOptions = Object.fromEntries(Object.entries(selectedOptions).filter(([, values]) => values.length > 0));
  if (Object.keys(activeOptions).length > 0) params.set("options", JSON.stringify(activeOptions));
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
