// Pure shape and header checks for the platform feed smoke script. Each
// validator returns a list of human-readable problems (empty = fine). They only
// look at keys and types, never at content, and keep nothing from the response.

export const STORELENS_ORIGIN = "https://storelens.pages.dev";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumeric = (v) => (typeof v === "number" || typeof v === "string") && v !== "" && Number.isFinite(Number(v));

// Reports each distinct problem once, with how many items had it, so a page of
// 250 broken products doesn't print 250 lines.
function collect(items, check) {
  const counts = new Map();
  for (const item of items) {
    for (const problem of check(item)) counts.set(problem, (counts.get(problem) ?? 0) + 1);
  }
  return [...counts].map(([problem, n]) => (items.length > 1 ? `${problem} (${n}/${items.length})` : problem));
}

function requireKeys(obj, keys, prefix) {
  if (!isObject(obj)) return [`${prefix} is not an object`];
  return keys.filter((k) => !(k in obj)).map((k) => `${prefix}.${k} missing`);
}

export function checkCors(headers) {
  const value = headers.get("access-control-allow-origin");
  if (value === "*" || value === STORELENS_ORIGIN) return [];
  return [value ? `Access-Control-Allow-Origin is "${value}"` : "no Access-Control-Allow-Origin header"];
}

// Shopify /collections/{handle}/products.json
const SHOPIFY_PRODUCT_KEYS = [
  "id", "title", "handle", "body_html", "vendor", "product_type", "tags", "created_at", "variants", "images", "options",
];
const SHOPIFY_VARIANT_KEYS = ["id", "title", "price", "compare_at_price", "available", "option1", "option2", "option3"];

export function validateShopifyPage(data) {
  if (!isObject(data) || !Array.isArray(data.products)) return ["response has no products array"];
  return collect(data.products, (p) => {
    if (!isObject(p)) return ["product is not an object"];
    const problems = requireKeys(p, SHOPIFY_PRODUCT_KEYS, "product");
    if (Array.isArray(p.variants)) {
      if (p.variants.length === 0) problems.push("product.variants is empty");
      for (const v of p.variants) {
        problems.push(...requireKeys(v, SHOPIFY_VARIANT_KEYS, "variant"));
        if (isObject(v) && !isNumeric(v.price)) problems.push("variant.price is not numeric");
      }
    } else if ("variants" in p) problems.push("product.variants is not an array");
    return [...new Set(problems)];
  });
}

// Shopify /collections.json, used for discovery. Its absence is tolerated.
export function validateShopifyCollections(data) {
  if (!isObject(data) || !Array.isArray(data.collections)) return ["response has no collections array"];
  return collect(data.collections.slice(0, 50), (c) => requireKeys(c, ["handle", "title", "products_count"], "collection"));
}

// Fourthwall /collections/{slug}/{n}.json
const FOURTHWALL_PRODUCT_KEYS = ["id", "title", "handle", "url", "image", "price", "compare_at_price", "available", "created_at", "variants"];

export function validateFourthwallPage(data, page) {
  if (!isObject(data) || !Array.isArray(data.products)) return ["response has no products array"];
  const problems = [];
  if (data.current_page !== page) problems.push(`current_page is ${JSON.stringify(data.current_page)}, expected ${page}`);
  problems.push(
    ...collect(data.products, (p) => {
      if (!isObject(p)) return ["product is not an object"];
      const found = requireKeys(p, FOURTHWALL_PRODUCT_KEYS, "product");
      if (typeof p.available !== "boolean") found.push("product.available is not a boolean");
      if (!isNumeric(p.price)) found.push("product.price is not numeric");
      if (p.compare_at_price != null && !isNumeric(p.compare_at_price)) found.push("product.compare_at_price is not numeric");
      if (!Array.isArray(p.variants) || p.variants.length === 0) found.push("product.variants is missing or empty");
      else {
        for (const v of p.variants) {
          found.push(...requireKeys(v, ["id", "title", "price"], "variant"));
          if (!isObject(v)) continue;
          if (isObject(v.price)) {
            if (!Number.isFinite(v.price.cents)) found.push("variant.price.cents is not a number");
            if (typeof v.price.currency_iso !== "string") found.push("variant.price.currency_iso is not a string");
          } else if ("price" in v) found.push("variant.price is not an object");
        }
      }
      return [...new Set(found)];
    })
  );
  return problems;
}

// Big Cartel api.bigcartel.com/{shop}/products.json
const BIGCARTEL_PRODUCT_KEYS = [
  "id", "name", "permalink", "url", "price", "default_price", "on_sale", "status", "created_at", "description", "images", "options",
];

export function validateBigCartelProducts(data) {
  if (!Array.isArray(data)) return ["response is not an array"];
  return collect(data, (p) => {
    if (!isObject(p)) return ["product is not an object"];
    const found = requireKeys(p, BIGCARTEL_PRODUCT_KEYS, "product");
    if (!isNumeric(p.price)) found.push("product.price is not numeric");
    if (typeof p.on_sale !== "boolean") found.push("product.on_sale is not a boolean");
    if (!Array.isArray(p.images)) found.push("product.images is not an array");
    if (Array.isArray(p.options)) {
      for (const o of p.options) {
        found.push(...requireKeys(o, ["id", "name", "price", "sold_out"], "option"));
        if (isObject(o) && typeof o.sold_out !== "boolean") found.push("option.sold_out is not a boolean");
      }
    } else if ("options" in p) found.push("product.options is not an array");
    return [...new Set(found)];
  });
}

// Overall status for one store, worst first.
const ORDER = ["fail", "gone", "warn", "pass"];
export function worstStatus(statuses) {
  return ORDER.find((s) => statuses.includes(s)) ?? "pass";
}
