// Shared checks that a platform adapter, and the products it returns, follow the
// neutral contract in src/lib/platforms/types.js. Every adapter's tests run
// these, so adapters can't drift from the model or from each other. See README.md.
import { expect } from "vitest";

// The capabilities the UI reads. An adapter must set exactly these, each to a
// boolean: a missing one reads as "unsupported" in some places and "supported"
// in others, and an unknown one is probably a typo or a stale name.
export const CAPABILITY_KEYS = ["vendors", "categories", "tags", "variantOptions", "variantStock", "collectionDiscovery"];

const isIdLike = (value) => typeof value === "string" || typeof value === "number";
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export function expectAdapterShape(adapter) {
  const where = `adapter "${adapter?.id}"`;
  expect(typeof adapter.id, `${where}: id`).toBe("string");
  expect(adapter.id.length, `${where}: id is empty`).toBeGreaterThan(0);
  expect(typeof adapter.name, `${where}: name`).toBe("string");

  expect(typeof adapter.labels?.vendors, `${where}: labels.vendors`).toBe("string");
  expect(typeof adapter.labels?.categories, `${where}: labels.categories`).toBe("string");

  const { capabilities } = adapter;
  expect(Object.keys(capabilities ?? {}).sort(), `${where}: capability keys`).toEqual([...CAPABILITY_KEYS].sort());
  for (const key of CAPABILITY_KEYS) {
    expect(typeof capabilities[key], `${where}: capabilities.${key} is not a boolean`).toBe("boolean");
  }

  for (const method of ["matchesUrl", "parseUrl", "collectionUrl", "fetchCollection"]) {
    expect(typeof adapter[method], `${where}: ${method} is not a function`).toBe("function");
  }

  // Without a collection listing there is nothing to choose from, so the
  // adapter must say which collection to open instead.
  if (capabilities.collectionDiscovery) {
    expect(typeof adapter.listCollections, `${where}: collectionDiscovery needs listCollections`).toBe("function");
  } else {
    expect(typeof adapter.defaultCollection, `${where}: no collectionDiscovery needs defaultCollection`).toBe("string");
    expect(adapter.defaultCollection.length, `${where}: defaultCollection is empty`).toBeGreaterThan(0);
  }
}

// `capabilities` is the adapter's own, used for the consistency checks: a
// platform that says it can't supply something must not supply it.
export function expectNeutralProduct(product, capabilities) {
  const where = `product ${JSON.stringify(product?.handle ?? product?.id)}`;
  const check = (value, what) => expect(value, `${where}: ${what}`);

  check(isIdLike(product.id), "id is a string or number").toBe(true);
  check(typeof product.handle, "handle").toBe("string");
  check(typeof product.title, "title").toBe("string");

  if (product.url !== null) {
    check(typeof product.url, "url is a string or null").toBe("string");
    check(() => new URL(product.url), `url "${product.url}" is not absolute`).not.toThrow();
    check(["http:", "https:"].includes(new URL(product.url).protocol), `url "${product.url}" is not http(s)`).toBe(true);
  }

  check(Array.isArray(product.images), "images is an array").toBe(true);
  for (const image of product.images) check(typeof image?.url, "images[].url").toBe("string");

  if (product.description !== undefined) check(typeof product.description, "description").toBe("string");

  for (const field of ["vendors", "categories", "tags"]) {
    check(isStringArray(product[field]), `${field} is an array of strings`).toBe(true);
  }

  if (product.currency !== undefined) check(product.currency, "currency is a 3-letter code").toMatch(/^[A-Z]{3}$/);

  check(typeof product.available, "available").toBe("boolean");

  if (product.createdAt !== undefined) {
    check(product.createdAt, `createdAt "${product.createdAt}" is not ISO 8601`).toMatch(ISO_8601);
    check(Number.isNaN(Date.parse(product.createdAt)), `createdAt "${product.createdAt}" doesn't parse`).toBe(false);
  }

  check(Array.isArray(product.options), "options is an array").toBe(true);
  for (const option of product.options) {
    check(typeof option?.name, "options[].name").toBe("string");
    check(isStringArray(option.values), `options[${option.name}].values is an array of strings`).toBe(true);
  }

  check(Array.isArray(product.variants), "variants is an array").toBe(true);
  for (const variant of product.variants) {
    check(isIdLike(variant.id), "variant id is a string or number").toBe(true);
    check(typeof variant.title, "variant title").toBe("string");
    check(Number.isFinite(variant.price), `variant price ${variant.price} is a finite number`).toBe(true);
    check(
      variant.compareAtPrice === null || Number.isFinite(variant.compareAtPrice),
      `variant compareAtPrice ${variant.compareAtPrice} is a number or null`
    ).toBe(true);
    check(typeof variant.available, "variant available").toBe("boolean");
    check(isStringArray(variant.options), "variant options is an array of strings").toBe(true);
    // Option values are by position, so a variant can't have more than the product has groups.
    check(variant.options.length <= product.options.length, "variant has more option values than the product has options").toBe(true);
  }

  // A product is available when any variant is.
  check(product.available, "available equals 'any variant available'").toBe(product.variants.some((v) => v.available));

  // A capability the platform lacks means the data is absent, not merely unused.
  if (capabilities.variantStock === false) {
    check(product.available, "variantStock is false, so every product is available").toBe(true);
    check(product.variants.every((v) => v.available), "variantStock is false, so every variant is available").toBe(true);
  }
  if (capabilities.vendors === false) check(product.vendors, "vendors capability is false").toEqual([]);
  if (capabilities.categories === false) check(product.categories, "categories capability is false").toEqual([]);
  if (capabilities.tags === false) check(product.tags, "tags capability is false").toEqual([]);
  // (Variant option values can't outnumber the options, so none are left either.)
  if (capabilities.variantOptions === false) check(product.options, "variantOptions capability is false").toEqual([]);
}
