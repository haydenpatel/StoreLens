import { getDiscountData, isDiscounted, shownVariants } from "@/lib/utils";
import { compareText } from "@/lib/locale";

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
// (see prepareProducts) rather than on every keystroke.
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

// Case and diacritics folded for search: "Café", "CAFÉ" and "cafe" are one text.
// The same for every viewer (no locale-dependent lowercasing or collation), so
// a shared ?q= link finds the same products everywhere. Only the Latin
// combining marks (U+0300-U+036F) are stripped, then the text is recomposed, so
// Japanese, Hindi and Korean text keeps its meaning (が stays が). Letters with
// no combining form (ß, ø, ligatures such as æ) are not folded.
export function foldText(text) {
  return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC").toLowerCase();
}

// The folded `titleSearch` / `descriptionSearch` a product is searched by. The
// description's plain text is not kept (only its folded form), so a product
// holds two copies of the description (markup and folded), not three.
const searchFieldsOf = (product) => ({
  titleSearch: foldText(product.title),
  descriptionSearch: foldText(htmlToText(product.description)),
});

// A product's creation time in ms, or 0 when it has no date or one that doesn't
// parse, so those sort last under "Newest First" (NaN would leave their order
// undefined).
const createdTime = (product) => {
  const time = Date.parse(product.createdAt);
  return Number.isFinite(time) ? time : 0;
};

// The lowest and highest usable variant price, +/-Infinity when none has one.
function priceBounds(variants) {
  let min = Infinity;
  let max = -Infinity;
  variants.forEach(({ price }) => {
    if (!Number.isFinite(price)) return;
    if (price < min) min = price;
    if (price > max) max = price;
  });
  return { min, max };
}

// What each numeric sort orders by, from a product's shown variants. A narrowed
// product (see filterByVariant) gets only the key of the active sort worked out
// when sorting; the others have all of them from load (see prepareProducts).
const SORT_KEYS = {
  "price-asc": (product) => priceBounds(shownVariants(product)).min,
  "price-desc": (product) => priceBounds(shownVariants(product)).max,
  "discount-percent": (product) => getDiscountData(shownVariants(product)).discountPercent,
  "discount-amount": (product) => getDiscountData(shownVariants(product)).discountAmount,
  newest: createdTime,
};

// `sortKeys` for a product with all its variants shown: one key per numeric sort.
function sortKeysOf(product) {
  const variants = product.variants ?? [];
  const { min, max } = priceBounds(variants);
  const { discountPercent, discountAmount } = getDiscountData(variants);
  return {
    "price-asc": min,
    "price-desc": max,
    "discount-percent": discountPercent,
    "discount-amount": discountAmount,
    newest: createdTime(product),
  };
}

// Adds what search and sorting need to each product, once when products load
// rather than on every keystroke or comparison: the folded search text and the
// sort keys. Products without them (as in tests) still work, just slower.
export function prepareProducts(products) {
  return products.map((product) => ({ ...product, ...searchFieldsOf(product), sortKeys: sortKeysOf(product) }));
}

// Parses filter/sort state out of the URL's query string (?q=...&vendor=a&vendor=b&...).
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
      const displayValues = [...values.values()].map(pickCasing).sort(compareText);
      return { name, key: name, values: displayValues };
    });

  return {
    vendors: Array.from(vendors).sort(compareText),
    types: Array.from(types).sort(compareText),
    tags: Array.from(tags).sort(compareText),
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

// a - b that treats an unpriced product (+/-Infinity, where the difference
// would be NaN) as equal to another unpriced one.
const comparePrices = (a, b) => (a === b ? 0 : a - b);

// A product's option names mapped to the position of the first option with that
// name (normalised), as the variants' `options` are indexed. Worked out once per
// options list (the products a filter narrows share it with the original).
const optionIndexes = new WeakMap();
function optionIndexOf(product) {
  const { options } = product;
  if (!options) return null;
  let indexes = optionIndexes.get(options);
  if (!indexes) {
    indexes = new Map();
    options.forEach((option, index) => {
      const key = normalizeOptionName(option.name);
      if (key && !indexes.has(key)) indexes.set(key, index);
    });
    optionIndexes.set(options, indexes);
  }
  return indexes;
}

// Normalised option values, remembered for one filter or count run: stores
// repeat the same few values across thousands of variants.
function valueNormalizer() {
  const seen = new Map();
  return (value) => {
    let key = seen.get(value);
    if (key === undefined) {
      key = normalizeOptionValue(value);
      seen.set(value, key);
    }
    return key;
  };
}

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
  const normalize = valueNormalizer();
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
    const indexes = optionIndexOf(product);
    const checks = selections.map(({ target, wanted }) => ({ index: indexes?.get(target) ?? -1, wanted }));
    if (checks.some(({ index }) => index < 0)) return;
    // A variant with no usable price has nothing to compare, so the range
    // never excludes it; but it can't make a product match on its own when
    // other variants are priced (a product with no priced variant at all stays,
    // and the card shows "Price unavailable").
    const anyPriced = variants.some(v => Number.isFinite(v.price));
    const passesNarrowing = (v) =>
      checks.every(({ index, wanted }) => {
        const value = v.options?.[index];
        return value != null && wanted.has(normalize(value));
      }) &&
      (!saleOnly || isDiscounted(v)) &&
      (!Number.isFinite(v.price) || (v.price >= priceRange[0] && v.price <= priceRange[1]));
    // The no-priced-match rule looks at the variants before the stock test, so
    // In stock only alone never drops a product it didn't drop before.
    const narrowed = variants.filter(passesNarrowing);
    if (narrowed.length === 0 || (anyPriced && !narrowed.some(v => Number.isFinite(v.price)))) return;
    const matching = inStockOnly ? narrowed.filter(v => v.available) : narrowed;
    if (matching.length === 0) return;
    result.push(narrowed.length < variants.length ? { ...product, matchingVariants: matching } : product);
  });
  return result;
}

// The filters that look at the product as a whole (search, vendor, type, tag).
// The product list and the option counts both start from this, so a caller
// that needs both runs it once and passes the result to each.
export function scopeProducts(products, state, capabilities = {}) {
  const { searchQuery, selectedVendors, selectedTypes, selectedTags } = withoutUnsupportedSelections(state, capabilities);
  let filtered = products;

  if (searchQuery) {
    const query = foldText(searchQuery);
    filtered = filtered.filter(p =>
      (p.titleSearch ?? foldText(p.title)).includes(query) ||
      (p.descriptionSearch ?? foldText(htmlToText(p.description))).includes(query)
    );
  }
  if (selectedVendors.length > 0) {
    filtered = filtered.filter(p => p.vendors?.some(v => selectedVendors.includes(v)));
  }
  if (selectedTypes.length > 0) {
    filtered = filtered.filter(p => p.categories?.some(c => selectedTypes.includes(c)));
  }
  if (selectedTags.length > 0) {
    filtered = filtered.filter(p => selectedTags.some(tag => p.tags?.includes(tag)));
  }
  return filtered;
}

// Per-product tally for computeOptionCounts: a value's bit 1 means a variant
// passing the filters has it and a price, bit 2 that one is also in stock.
const PRICED = 1;
const STOCKED = 2;

// How many products each variant-option value would return, for the counts
// beside the option filters: Map of option key -> Map of normalised value ->
// number of products. A product counts for a value when one of its variants
// has that value and passes every other current filter (the other options'
// selections, stock, price, sale, and the search/vendor/type/tag filters). The
// option's own selection is left out of its own counts, so a value shows what
// picking it would add. Products are counted, never variants, and the whole
// thing is one pass over the products: each variant is tested once, and the
// selected options it fails say which options' counts it may still feed (none
// if it fails two, only that option's if it fails one, all if it fails none).
// The rules mirror filterByVariant (a test checks they agree). `scoped` is the
// scopeProducts result when the caller already has it.
export function computeOptionCounts(products, state, capabilities = {}, scoped = scopeProducts(products, state, capabilities)) {
  const result = new Map();
  const {
    selectedOptions, priceRange, saleOnly,
  } = withoutUnsupportedSelections(state, capabilities);
  if (capabilities.variantOptions === false) return result;
  const inStockOnly = capabilities.variantStock === false ? false : state.inStockOnly;
  const normalize = valueNormalizer();

  const selections = new Map();
  Object.entries(selectedOptions).forEach(([name, values]) => {
    if (values.length > 0) selections.set(normalizeOptionName(name), new Set(values.map(normalizeOptionValue)));
  });

  // One tally per option name of the product in hand (value -> flags), reused
  // from product to product.
  const tallies = [];
  scoped.forEach(product => {
    const variants = product.variants || [];
    const indexByName = optionIndexOf(product);
    if (variants.length === 0 || !indexByName) return;
    // A selected option the product doesn't have rules every other count out.
    const checks = [];
    for (const [name, wanted] of selections) {
      const index = indexByName.get(name);
      if (index === undefined) return;
      checks.push({ name, index, wanted });
    }
    const slots = [];
    indexByName.forEach((index, name) => {
      const slot = slots.length;
      if (!tallies[slot]) tallies[slot] = new Map();
      else tallies[slot].clear();
      slots.push({ name, index, tally: tallies[slot] });
    });
    const anyPriced = variants.some(v => Number.isFinite(v.price));
    variants.forEach(variant => {
      if (saleOnly && !isDiscounted(variant)) return;
      if (Number.isFinite(variant.price) && (variant.price < priceRange[0] || variant.price > priceRange[1])) return;
      let failedName = null;
      for (const { name, index, wanted } of checks) {
        const value = variant.options?.[index];
        if (value != null && wanted.has(normalize(value))) continue;
        if (failedName !== null) return;
        failedName = name;
      }
      const flags = (Number.isFinite(variant.price) ? PRICED : 0) | (!inStockOnly || variant.available ? STOCKED : 0);
      for (const { name, index, tally } of slots) {
        if (failedName !== null && failedName !== name) continue;
        const value = variant.options?.[index];
        if (!value) continue;
        const valueKey = normalize(value);
        if (!valueKey) continue;
        tally.set(valueKey, (tally.get(valueKey) ?? 0) | flags);
      }
    });
    for (const { name, tally } of slots) {
      if (tally.size === 0) continue;
      const counts = result.get(name) ?? new Map();
      tally.forEach((flags, valueKey) => {
        if ((flags & STOCKED) && (!anyPriced || (flags & PRICED))) counts.set(valueKey, (counts.get(valueKey) ?? 0) + 1);
      });
      result.set(name, counts);
    }
  });
  return result;
}

// `scoped` is the scopeProducts result when the caller already has it (the
// option counts start from the same list).
export function filterAndSortProducts(products, state, capabilities = {}, scoped = scopeProducts(products, state, capabilities)) {
  const {
    selectedOptions, priceRange, saleOnly, sortBy,
  } = withoutUnsupportedSelections(state, capabilities);
  // Without stock data nothing can be filtered by it.
  const inStockOnly = capabilities.variantStock === false ? false : state.inStockOnly;

  // Variant-level filters (options, in stock, price, on sale) are ANDed into
  // one test per variant, so a product matches only when a single variant
  // passes all of them together (Size S and Color Blue means an S/Blue variant,
  // not an S one and a Blue one).
  const filtered = filterByVariant(scoped, { selectedOptions, inStockOnly, saleOnly, priceRange });

  if (sortBy === "title-asc" || sortBy === "title-desc") {
    const direction = sortBy === "title-asc" ? 1 : -1;
    return filtered.sort((a, b) => direction * compareText(a.title || "", b.title || ""));
  }
  const keyOf = SORT_KEYS[sortBy];
  if (!keyOf) return filtered;
  // Each product's key is read once, then the sort compares plain numbers.
  // Narrowed products (carrying matchingVariants) don't use the keys from load,
  // which describe all their variants.
  const keys = filtered.map(product => (product.sortKeys && !product.matchingVariants ? product.sortKeys[sortBy] : keyOf(product)));
  // Price low to high; every other sort puts the biggest first.
  const ascending = sortBy === "price-asc";
  const order = filtered.map((_, index) => index);
  order.sort((i, j) => (ascending ? comparePrices(keys[i], keys[j]) : comparePrices(keys[j], keys[i])));
  return order.map(index => filtered[index]);
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
