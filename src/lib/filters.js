import { getDiscountData, isDiscounted } from "@/lib/utils";

// Pure filter/sort/URL-param logic over the platform-neutral product shape
// (see platforms/types.js), kept out of the page component so it can be unit
// tested without rendering it.

// The sort values the sort dropdown offers (ProductGrid); anything else in a
// link is ignored.
export const SORT_VALUES = [
  "title-asc",
  "title-desc",
  "price-asc",
  "price-desc",
  "newest",
  "discount-percent",
  "discount-amount",
];

// The text of an HTML description, for search. Done once when products load
// (see withSearchText) rather than on every keystroke.
export function htmlToText(html) {
  if (!html) return "";
  const source = String(html);
  try {
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(source, "text/html");
      return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
    }
  } catch {
    /* fall back to a plain tag strip */
  }
  const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
  return source
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (entity) => entities[entity])
    .replace(/\s+/g, " ")
    .trim();
}

// Adds `descriptionText` (the description without its markup) to each product.
export function withSearchText(products) {
  return products.map((product) => ({ ...product, descriptionText: htmlToText(product.description) }));
}

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
  // An empty value (?minPrice=&maxPrice=) is absent, not zero.
  const minParam = params.get("minPrice");
  const maxParam = params.get("maxPrice");
  if (minParam?.trim() && maxParam?.trim()) {
    const min = Number(minParam);
    const max = Number(maxParam);
    // Number.isFinite (not just !isNaN) rejects Infinity/-Infinity too - a
    // link like ?minPrice=Infinity&maxPrice=Infinity parses without error
    // but then fails every product's price check, silently filtering out
    // the entire collection. Also reject an inverted range (min > max),
    // which would do the same.
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      result.priceRange = [min, max];
    }
  }
  // An unknown sort would leave the dropdown blank and the grid unsorted.
  if (params.has("sort") && SORT_VALUES.includes(params.get("sort"))) {
    result.sortBy = params.get("sort");
  }

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

// Matches vendor, category or tag selections read from a link to the values
// this collection has. A value that is there exactly is kept as is; otherwise
// it is compared ignoring case and surrounding whitespace and selects every
// spelling the collection has ("ACME" picks both "Acme" and "acme", as they
// are separate values when filtering). A value it doesn't have can't match
// anything, so it is dropped and returned in `ignored`.
export function restoreListSelections(selected, available) {
  const spellings = new Map();
  available.forEach(value => {
    const key = normalizeOptionValue(value);
    spellings.set(key, [...(spellings.get(key) ?? []), value]);
  });
  const values = [];
  const ignored = [];
  selected.forEach(value => {
    const matches = available.includes(value) ? [value] : spellings.get(normalizeOptionValue(value));
    if (!matches) ignored.push(value);
    else matches.forEach(match => { if (!values.includes(match)) values.push(match); });
  });
  return { values, ignored };
}

// Fits a price range read from a link to this collection's prices: clamped to
// its lowest and highest. A range that misses them entirely can't show
// anything, so it is dropped (null).
export function restorePriceRange([min, max], minPrice, maxPrice) {
  if (max < minPrice || min > maxPrice) return null;
  return [Math.max(min, minPrice), Math.min(max, maxPrice)];
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

// A product's creation time in ms, or 0 when it has no date or one that doesn't
// parse, so those sort last under "Newest First" (NaN would leave their order
// undefined).
const createdTime = (product) => {
  const time = Date.parse(product.createdAt);
  return Number.isFinite(time) ? time : 0;
};

// The variants a product is shown by while filters narrow them: set by
// filterAndSortProducts as `matchingVariants`, absent when no filter narrows.
const variantsOf = (product) => product.matchingVariants ?? product.variants ?? [];

const pricesOf = (product) => variantsOf(product).map(v => v.price).filter(Number.isFinite);

// a - b that treats an unpriced product (+/-Infinity, where the difference
// would be NaN) as equal to another unpriced one.
const comparePrices = (a, b) => (a === b ? 0 : a - b);

// Keeps the products with at least one variant passing every variant-level
// filter. Option selections are OR within an option's values and AND across
// options, matched by normalised option name (wherever it sits in the
// product's options) and value; a variant with no value for a selected option
// (a missing or empty entry) doesn't match it. A product without a selected
// option, or without variants while options or "On sale only" apply, can't
// match; with only the stock or price filters it stays (no data to say no).
//
// A product whose variants are narrowed by options, sale or price (not by
// stock alone, which is on by default) comes back as a copy carrying
// `matchingVariants`, which the card and the sorts use in place of all its
// variants. Other products are returned as they are.
function filterByVariant(products, { selectedOptions, inStockOnly, saleOnly, priceRange }) {
  const selections = Object.entries(selectedOptions)
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => ({ target: normalizeOptionName(name), wanted: new Set(values.map(normalizeOptionValue)) }));

  const result = [];
  products.forEach(product => {
    const variants = product.variants || [];
    if (variants.length === 0) {
      if (selections.length === 0 && !saleOnly) result.push(product);
      return;
    }
    const checks = selections.map(({ target, wanted }) => ({
      index: product.options?.findIndex(o => normalizeOptionName(o.name) === target) ?? -1,
      wanted,
    }));
    if (checks.some(({ index }) => index < 0)) return;
    // A variant with no usable price has nothing to compare, so the range
    // never excludes it; but it can't make a product match on its own when
    // other variants are priced (a product with no priced variant at all stays,
    // and the card shows "Price unavailable").
    const anyPriced = variants.some(v => Number.isFinite(v.price));
    const passesNarrowing = (v) =>
      checks.every(({ index, wanted }) => {
        const value = v.options?.[index];
        return value != null && wanted.has(normalizeOptionValue(value));
      }) &&
      (!saleOnly || isDiscounted(v)) &&
      (!Number.isFinite(v.price) || (v.price >= priceRange[0] && v.price <= priceRange[1]));
    const matching = variants.filter(v => passesNarrowing(v) && (!inStockOnly || v.available));
    if (matching.length === 0 || (anyPriced && !matching.some(v => Number.isFinite(v.price)))) return;
    result.push(variants.some(v => !passesNarrowing(v)) ? { ...product, matchingVariants: matching } : product);
  });
  return result;
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
      (p.descriptionText ?? htmlToText(p.description)).toLowerCase().includes(query)
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

  // Variant-level filters (options, in stock, price, on sale) are ANDed into
  // one test per variant, so a product matches only when a single variant
  // passes all of them together (Size S and Color Blue means an S/Blue variant,
  // not an S one and a Blue one).
  filtered = filterByVariant(filtered, { selectedOptions, inStockOnly, saleOnly, priceRange });

  // Sort
  filtered.sort((a, b) => {
    switch (sortBy) {
      case "title-asc":
        return (a.title || "").localeCompare(b.title || "");
      case "title-desc":
        return (b.title || "").localeCompare(a.title || "");
      case "price-asc": {
        const aMin = Math.min(...pricesOf(a), Infinity);
        const bMin = Math.min(...pricesOf(b), Infinity);
        return comparePrices(aMin, bMin);
      }
      case "price-desc": {
        const aMax = Math.max(...pricesOf(a), -Infinity);
        const bMax = Math.max(...pricesOf(b), -Infinity);
        return comparePrices(bMax, aMax);
      }
      case "newest":
        return createdTime(b) - createdTime(a);
      case "discount-percent":
        return (
          getDiscountData(variantsOf(b)).discountPercent -
          getDiscountData(variantsOf(a)).discountPercent
        );
      case "discount-amount":
        return (
          getDiscountData(variantsOf(b)).discountAmount -
          getDiscountData(variantsOf(a)).discountAmount
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
