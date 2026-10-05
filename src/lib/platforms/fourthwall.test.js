import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fourthwallAdapter, MAX_PRODUCT_PAGES, normalizeFourthwallProduct } from "./fourthwall";
import { catalog, collectionPage, product, variant } from "../__fixtures__/fourthwall";
import { fakeFourthwallFetch, PAGE_SIZE } from "../__fixtures__/fake-fourthwall-fetch";
import { jsonResponse } from "../__fixtures__/test-helpers";

const ORIGIN = "https://shop.example.com";
const url = (u) => new URL(u);
const parse = (u) => fourthwallAdapter.parseUrl(url(u));
const many = (n) => Array.from({ length: n }, (_, i) => product({ title: `Item ${i + 1}`, handle: `item-${i + 1}` }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseUrl", () => {
  it.each([
    ["a collection", `${ORIGIN}/collections/tees`, "tees"],
    ["the collection .json form", `${ORIGIN}/collections/tees.json`, "tees"],
    ["a collection's /products page", `${ORIGIN}/collections/all/products`, "all"],
    ["a numbered page", `${ORIGIN}/collections/all/3`, "all"],
    ["a numbered .json page", `${ORIGIN}/collections/all/3.json`, "all"],
    ["a trailing slash", `${ORIGIN}/collections/tees/`, "tees"],
    ["upper case", `${ORIGIN}/Collections/Tees`, "Tees"],
  ])("finds the collection in %s", (_, input, collection) => {
    expect(parse(input)).toEqual({ origin: ORIGIN, collection });
  });

  it("keeps a leading locale as part of the origin", () => {
    expect(parse(`${ORIGIN}/en-nzd/collections/all/products`)).toEqual({ origin: `${ORIGIN}/en-nzd`, collection: "all" });
    expect(parse(`${ORIGIN}/en-usd/collections/tees.json`)).toEqual({ origin: `${ORIGIN}/en-usd`, collection: "tees" });
  });

  it("treats a locale-only root as that market's bare store", () => {
    expect(parse(`${ORIGIN}/en-nzd`)).toEqual({ origin: `${ORIGIN}/en-nzd`, collection: null });
    expect(parse(`${ORIGIN}/en-nzd/`)).toEqual({ origin: `${ORIGIN}/en-nzd`, collection: null });
  });

  it("returns a null collection for the root, a product page and other pages", () => {
    expect(parse(ORIGIN)).toEqual({ origin: ORIGIN, collection: null });
    expect(parse(`${ORIGIN}/products/example-tee`)).toEqual({ origin: ORIGIN, collection: null });
    expect(parse(`${ORIGIN}/about`)).toEqual({ origin: ORIGIN, collection: null });
    expect(parse(`${ORIGIN}/collections/all/products/example-tee`)).toEqual({ origin: ORIGIN, collection: null });
  });

  it("does not treat an ordinary first segment as a locale", () => {
    expect(parse(`${ORIGIN}/shop/collections/all`)).toEqual({ origin: ORIGIN, collection: null });
  });

  it("keeps the port", () => {
    expect(parse("http://localhost:8080/collections/all").origin).toBe("http://localhost:8080");
  });
});

describe("metadata", () => {
  it("builds /collections/<slug> on the origin, locale included", () => {
    expect(fourthwallAdapter.collectionUrl(ORIGIN, "tees")).toBe(`${ORIGIN}/collections/tees`);
    expect(fourthwallAdapter.collectionUrl(`${ORIGIN}/en-nzd`, "all")).toBe(`${ORIGIN}/en-nzd/collections/all`);
  });

  it("recognises only a numbered page URL on its own", () => {
    expect(fourthwallAdapter.matchesUrl(url(`${ORIGIN}/collections/all/2.json`))).toBe(true);
    expect(fourthwallAdapter.matchesUrl(url(`${ORIGIN}/en-nzd/collections/tees/10.json`))).toBe(true);
    expect(fourthwallAdapter.matchesUrl(url(`${ORIGIN}/collections/all`))).toBe(false);
    expect(fourthwallAdapter.matchesUrl(url(`${ORIGIN}/collections/all.json`))).toBe(false);
    expect(fourthwallAdapter.matchesUrl(url(`${ORIGIN}/collections/all/products`))).toBe(false);
    expect(fourthwallAdapter.matchesUrl(url(ORIGIN))).toBe(false);
  });

  it("explains in the collection dropdown why only some collections are offered", () => {
    expect(fourthwallAdapter.collectionsNote).toMatch(/doesn't let StoreLens list/);
  });

  it("opens the 'all' collection for a bare store, with no collection listing", () => {
    expect(fourthwallAdapter.defaultCollection).toBe("all");
    expect(fourthwallAdapter.capabilities.collectionDiscovery).toBe(false);
    expect(fourthwallAdapter.listCollections).toBeUndefined();
  });

  it("identifies itself and says what it can't supply", () => {
    expect(fourthwallAdapter.id).toBe("fourthwall");
    expect(fourthwallAdapter.name).toBe("Fourthwall");
    expect(fourthwallAdapter.capabilities).toMatchObject({
      vendors: false,
      categories: false,
      tags: false,
      variantOptions: true,
      variantStock: true,
    });
  });
});

describe("normalizeFourthwallProduct", () => {
  const normalize = (raw, origin = ORIGIN) => normalizeFourthwallProduct(raw, origin);

  it("maps a product onto the neutral shape", () => {
    const n = normalize(
      product({ id: "p1", handle: "tee", title: "Tee", image: "https://example.com/tee.webp", url: "/products/tee", variants: [variant("S", { cents: 2500 })] })
    );
    expect(n).toEqual({
      id: "p1",
      handle: "tee",
      title: "Tee",
      url: `${ORIGIN}/products/tee`,
      images: [{ url: "https://example.com/tee.webp" }],
      vendors: [],
      categories: [],
      tags: [],
      currency: "USD",
      available: true,
      createdAt: "2026-09-28T18:59:56Z",
      variants: [expect.objectContaining({ title: "S", price: 25, compareAtPrice: null, available: true, options: ["S"] })],
      options: [{ name: "Size", values: ["S"] }],
    });
    expect(n).not.toHaveProperty("description");
  });

  it("links to the product on the origin, locale included", () => {
    expect(normalize(product({ url: "/products/tee" }), `${ORIGIN}/en-nzd`).url).toBe(`${ORIGIN}/en-nzd/products/tee`);
  });

  it("builds the link from the handle when the feed gives none", () => {
    expect(normalize(product({ handle: "tee", url: undefined })).url).toBe(`${ORIGIN}/products/tee`);
  });

  it("has no image list entry without an image", () => {
    expect(normalize(product({ image: null })).images).toEqual([]);
  });

  it("takes the currency from a variant, and leaves it out if none is a 3-letter code", () => {
    expect(normalize(product({ variants: [variant("S", { currency: "NZD" })] })).currency).toBe("NZD");
    expect(normalize(product({ variants: [variant("S", { currency: "nzd" })] }))).not.toHaveProperty("currency");
    expect(normalize(product({ variants: [] }))).not.toHaveProperty("currency");
  });

  describe("dates", () => {
    it("converts Fourthwall's format to ISO 8601", () => {
      expect(normalize(product({ created_at: "2026-09-28 18:59:56 UTC" })).createdAt).toBe("2026-09-28T18:59:56Z");
    });

    it("keeps a date that is already ISO 8601 with a zone", () => {
      expect(normalize(product({ created_at: "2026-09-28T18:59:56+13:00" })).createdAt).toBe("2026-09-28T18:59:56+13:00");
    });

    it.each([[undefined], [null], [""], ["last week"], ["2026-13-45 10:00:00 UTC"], ["2026-09-28T18:59:56"]])(
      "leaves createdAt out for %j",
      (value) => {
        expect(normalize(product({ created_at: value }))).not.toHaveProperty("createdAt");
      }
    );
  });

  describe("prices and sales", () => {
    it("uses each variant's own price, in whole currency units", () => {
      const n = normalize(product({ variants: [variant("S", { cents: 2000 }), variant("2XL", { cents: 2250 })] }));
      expect(n.variants.map((v) => v.price)).toEqual([20, 22.5]);
    });

    it("falls back to the product price when a variant has none", () => {
      const n = normalize(product({ price: "18.00", variants: [{ id: "v", title: "S" }] }));
      expect(n.variants[0].price).toBe(18);
    });

    it("puts the compare-at price on every variant sold below it", () => {
      const n = normalize(
        product({ price: "40.00", compare_at_price: "55.00", variants: [variant("M", { cents: 4000 }), variant("2XL", { cents: 4400 })] })
      );
      expect(n.variants.map((v) => v.compareAtPrice)).toEqual([55, 55]);
    });

    it("does not call a variant dearer than the compare-at price a sale", () => {
      const n = normalize(
        product({ price: "40.00", compare_at_price: "42.00", variants: [variant("M", { cents: 4000 }), variant("2XL", { cents: 4200 }), variant("3XL", { cents: 4500 })] })
      );
      expect(n.variants.map((v) => v.compareAtPrice)).toEqual([42, null, null]);
    });

    it.each([[null], [undefined], ["0.00"], ["not a price"]])("has no sale when compare_at_price is %j", (value) => {
      expect(normalize(product({ compare_at_price: value })).variants.every((v) => v.compareAtPrice === null)).toBe(true);
    });
  });

  describe("stock", () => {
    it("reports every variant with the product's own availability", () => {
      const inStock = normalize(product({ available: true }));
      expect(inStock.available).toBe(true);
      expect(inStock.variants.every((v) => v.available)).toBe(true);

      const soldOut = normalize(product({ available: false }));
      expect(soldOut.available).toBe(false);
      expect(soldOut.variants.every((v) => !v.available)).toBe(true);
    });

    it("is unavailable with no variants, whatever the feed's flag says: there is nothing to buy", () => {
      expect(normalize(product({ available: true, variants: [] })).available).toBe(false);
      expect(normalize(product({ available: false, variants: [] })).available).toBe(false);
    });
  });

  describe("guessing option names from a variant title", () => {
    const optionsOf = (titles) => normalize(product({ variants: titles.map((t) => variant(t)) }));

    it("splits 'Colour, Size' and names the size group 'Size'", () => {
      const n = optionsOf(["Black, XS", "Black, S", "Vintage Black, XS", "Vintage Black, S"]);
      expect(n.options).toEqual([
        { name: "Option 1", values: ["Black", "Vintage Black"] },
        { name: "Size", values: ["XS", "S"] },
      ]);
      expect(n.variants.map((v) => v.options)).toEqual([
        ["Black", "XS"],
        ["Black", "S"],
        ["Vintage Black", "XS"],
        ["Vintage Black", "S"],
      ]);
    });

    it("names a size-only title 'Size'", () => {
      expect(optionsOf(["S", "M", "L", "XL", "2XL"]).options).toEqual([{ name: "Size", values: ["S", "M", "L", "XL", "2XL"] }]);
    });

    it.each([
      [["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"]],
      [["One Size"]],
      [["6", "6.5", "7", "10", "12"]],
      [["S/M", "L/XL"]],
    ])("recognises %j as sizes", (titles) => {
      expect(optionsOf(titles).options[0].name).toBe("Size");
    });

    it.each([[["White", "Blue"]], [["Small Pack", "Large Pack"]], [["S", "M", "Blue"]]])("does not call %j sizes", (titles) => {
      expect(optionsOf(titles).options[0].name).toBe("Option 1");
    });

    it("calls only the first size-like group 'Size'", () => {
      expect(optionsOf(["S, M", "S, L", "M, M", "M, L"]).options.map((o) => o.name)).toEqual(["Size", "Option 2"]);
    });

    it("has no options for a product with only a placeholder variant", () => {
      const n = optionsOf(["Default"]);
      expect(n.options).toEqual([]);
      expect(n.variants[0]).toMatchObject({ title: "", options: [] });
      expect(optionsOf(["Default Title"]).options).toEqual([]);
    });

    it("keeps a real title when there is more than one variant, even one called Default", () => {
      expect(optionsOf(["Default", "Large"]).options).toHaveLength(1);
    });

    it("keeps titles whole as one option when they don't split the same way for every variant", () => {
      const n = optionsOf(["Black, XS", "Black, Vintage Wash, S"]);
      expect(n.options).toEqual([{ name: "Option 1", values: ["Black, XS", "Black, Vintage Wash, S"] }]);
      expect(n.variants.map((v) => v.options)).toEqual([["Black, XS"], ["Black, Vintage Wash, S"]]);
    });

    it("keeps the variant title when there are options", () => {
      expect(optionsOf(["Black, XS"]).variants[0].title).toBe("Black, XS");
    });

    it("has no options and no variants for a product with none", () => {
      const n = normalize(product({ variants: [] }));
      expect(n.variants).toEqual([]);
      expect(n.options).toEqual([]);
    });
  });
});

describe("fetchCollection", () => {
  const COLLECTION = `${ORIGIN}/collections/all`;
  const stubShop = (products, collection = "all", override, options) => {
    const fetchMock = fakeFourthwallFetch({ "shop.example.com": { collections: { [collection]: products } } }, override, options);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const pathsRequested = (fetchMock) => fetchMock.calls.map((u) => u.pathname + u.search);

  it("requests numbered pages of the collection, never ?page=", async () => {
    const fetchMock = stubShop(many(3));
    const result = await fourthwallAdapter.fetchCollection(COLLECTION);
    expect(result.products).toHaveLength(3);
    expect(pathsRequested(fetchMock)).toContain("/collections/all/1.json");
    expect(pathsRequested(fetchMock).every((p) => !p.includes("?"))).toBe(true);
  });

  it("keeps a locale prefix in the request and the product links", async () => {
    const fetchMock = stubShop(many(2));
    const result = await fourthwallAdapter.fetchCollection(`${ORIGIN}/en-nzd/collections/all`);
    expect(pathsRequested(fetchMock)[0]).toBe("/en-nzd/collections/all/1.json");
    expect(result.products[0].url).toMatch(/^https:\/\/shop\.example\.com\/en-nzd\/products\//);
  });

  it("loads every page, in order, until an empty one", async () => {
    stubShop(many(PAGE_SIZE * 2 + 5));
    const result = await fourthwallAdapter.fetchCollection(COLLECTION);
    expect(result.products).toHaveLength(PAGE_SIZE * 2 + 5);
    expect(result.products.map((p) => p.title).slice(0, 3)).toEqual(["Item 1", "Item 2", "Item 3"]);
    expect(result.products.at(-1).title).toBe(`Item ${PAGE_SIZE * 2 + 5}`);
    expect(result).toMatchObject({ pageError: null, truncated: false });
  });

  it("returns no products, and no error, for an empty shop", async () => {
    stubShop([]);
    expect(await fourthwallAdapter.fetchCollection(COLLECTION)).toMatchObject({ products: [], pageError: null, truncated: false });
  });

  it("fetches four pages at a time, never more", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = (u) => {
      if (!/\/collections\/all\/\d+\.json$/.test(u.pathname)) return undefined;
      inFlight++;
      peak = Math.max(peak, inFlight);
      const page = Number(u.pathname.match(/\/(\d+)\.json$/)[1]);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          const items = many(PAGE_SIZE * 9).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          resolve(jsonResponse(collectionPage(items, { page })));
        }, 10)
      );
    };
    stubShop([], "all", slow);
    const run = fourthwallAdapter.fetchCollection(COLLECTION);
    await vi.runAllTimersAsync();
    const result = await run;
    expect(peak).toBe(4);
    expect(result.products).toHaveLength(PAGE_SIZE * 9);
  });

  it("reports the running product count as pages arrive", async () => {
    stubShop(many(PAGE_SIZE + 5));
    const onProgress = vi.fn();
    await fourthwallAdapter.fetchCollection(COLLECTION, { onProgress });
    const counts = onProgress.mock.calls.map(([p]) => p.loaded);
    expect(counts[0]).toBe(PAGE_SIZE);
    expect(counts.at(-1)).toBe(PAGE_SIZE + 5);
  });

  it("stops at maxPages and says there is more", async () => {
    const fetchMock = stubShop(many(PAGE_SIZE * 10));
    const result = await fourthwallAdapter.fetchCollection(COLLECTION, { maxPages: 3 });
    expect(result.products).toHaveLength(PAGE_SIZE * 3);
    expect(result.truncated).toBe(true);
    expect(pathsRequested(fetchMock).filter((p) => /\/\d+\.json$/.test(p))).toHaveLength(3);
  });

  it("has its own page cap, far above any shop seen", () => {
    expect(MAX_PRODUCT_PAGES).toBeGreaterThanOrEqual(50);
  });

  describe("notices", () => {
    it("says the option names are guessed when any product has options", async () => {
      stubShop(catalog());
      const { notices } = await fourthwallAdapter.fetchCollection(COLLECTION);
      expect(notices).toHaveLength(1);
      expect(notices[0].level).toBe("info");
      expect(notices[0].message).toMatch(/guesses the names/);
    });

    it("has none when no product has options", async () => {
      stubShop([product({ variants: [variant("Default")] })]);
      expect((await fourthwallAdapter.fetchCollection(COLLECTION)).notices).toEqual([]);
    });
  });

  describe("when the first page fails", () => {
    it("is not-found for a missing collection of a shop that can be read", async () => {
      // The feed's 404 has no CORS headers, so the browser sees fetch throw.
      stubShop(many(2), "all");
      const result = await fourthwallAdapter.fetchCollection(`${ORIGIN}/collections/missing`);
      expect(result.products).toEqual([]);
      expect(result.pageError.kind).toBe("not-found");
    });

    it("probes the shop's 'all' collection on the plain origin", async () => {
      const fetchMock = stubShop(many(2), "all");
      await fourthwallAdapter.fetchCollection(`${ORIGIN}/en-nzd/collections/missing`);
      expect(pathsRequested(fetchMock)).toContain("/collections/all.json");
    });

    it("is blocked-or-offline when nothing can be read from the browser", async () => {
      vi.stubGlobal("fetch", fakeFourthwallFetch({}));
      const result = await fourthwallAdapter.fetchCollection(COLLECTION);
      expect(result.pageError.kind).toBe("blocked-or-offline");
    });

    it("is not-found for a 404 when the shop's probe works", async () => {
      vi.stubGlobal("fetch", async (input) =>
        String(input).endsWith("/collections/all.json") ? jsonResponse({}) : jsonResponse({}, { ok: false, status: 404 })
      );
      expect((await fourthwallAdapter.fetchCollection(`${ORIGIN}/collections/tees`)).pageError.kind).toBe("not-found");
    });

    it("is locked for a 403, rate-limited for a lasting 429, without probing", async () => {
      const respond = (status) => vi.fn(async () => jsonResponse({}, { ok: false, status }));
      const locked = respond(403);
      vi.stubGlobal("fetch", locked);
      expect((await fourthwallAdapter.fetchCollection(COLLECTION)).pageError.kind).toBe("locked");
      expect(locked.mock.calls.some(([input]) => String(input).endsWith("/collections/all.json"))).toBe(false);

      vi.stubGlobal("fetch", respond(429));
      const run = fourthwallAdapter.fetchCollection(COLLECTION);
      await vi.runAllTimersAsync();
      expect((await run).pageError.kind).toBe("rate-limited");
    });

    it("is unsupported-platform when the answer isn't a product list", async () => {
      vi.stubGlobal("fetch", async () => jsonResponse({ collection: { handle: "all" } }));
      expect((await fourthwallAdapter.fetchCollection(COLLECTION)).pageError.kind).toBe("unsupported-platform");

      vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("x")) }));
      expect((await fourthwallAdapter.fetchCollection(COLLECTION)).pageError.kind).toBe("unsupported-platform");
    });

    it("is blocked-or-offline when the body can't be read to the end", async () => {
      vi.stubGlobal("fetch", async (input) => {
        if (String(input).endsWith("/collections/all.json")) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, json: async () => Promise.reject(new TypeError("network error")) };
      });
      expect((await fourthwallAdapter.fetchCollection(COLLECTION)).pageError.kind).toBe("blocked-or-offline");
    });
  });

  describe("when a later page fails", () => {
    const failPage = (page, how) => (u) =>
      u.pathname === `/collections/all/${page}.json` ? how() : undefined;

    it("keeps the pages before it and reports the error, dropping any after", async () => {
      stubShop(many(PAGE_SIZE * 6), "all", failPage(3, () => jsonResponse({}, { ok: false, status: 403 })));
      const result = await fourthwallAdapter.fetchCollection(COLLECTION);
      expect(result.products).toHaveLength(PAGE_SIZE * 2);
      expect(result.pageError.kind).toBe("locked");
    });

    it("reports a dropped connection as unreachable, without probing", async () => {
      const fetchMock = stubShop(many(PAGE_SIZE * 6), "all", failPage(2, () => {
        throw new TypeError("Failed to fetch");
      }));
      const result = await fourthwallAdapter.fetchCollection(COLLECTION);
      expect(result.products).toHaveLength(PAGE_SIZE);
      expect(result.pageError.kind).toBe("blocked-or-offline");
      expect(pathsRequested(fetchMock)).not.toContain("/collections/all.json");
    });

    it("doesn't call a later page's 404 a missing collection", async () => {
      stubShop(many(PAGE_SIZE * 6), "all", failPage(2, () => jsonResponse({}, { ok: false, status: 404 })));
      const result = await fourthwallAdapter.fetchCollection(COLLECTION);
      expect(result.products).toHaveLength(PAGE_SIZE);
      expect(result.pageError).toMatchObject({ kind: "empty", status: 404 });
    });

    it("retries a rate-limited page, then carries on", async () => {
      let limited = false;
      stubShop(many(PAGE_SIZE * 2), "all", (u) => {
        if (u.pathname === "/collections/all/2.json" && !limited) {
          limited = true;
          return jsonResponse({}, { ok: false, status: 429 });
        }
      });
      const run = fourthwallAdapter.fetchCollection(COLLECTION);
      await vi.runAllTimersAsync();
      const result = await run;
      expect(result.products).toHaveLength(PAGE_SIZE * 2);
      expect(result.pageError).toBeNull();
    });
  });

  it("rethrows an abort", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", async () => {
      controller.abort();
      throw abort;
    });
    await expect(fourthwallAdapter.fetchCollection(COLLECTION, { signal: controller.signal })).rejects.toBe(abort);
  });

  it("rethrows an abort that arrives while the body is read", async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        controller.abort();
        throw abort;
      },
    }));
    await expect(fourthwallAdapter.fetchCollection(COLLECTION, { signal: controller.signal })).rejects.toBe(abort);
  });

  it("throws for a URL with no collection, before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fourthwallAdapter.fetchCollection(ORIGIN)).rejects.toThrow("Please enter a valid Fourthwall collection URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("detect", () => {
  const detect = (target = `${ORIGIN}/collections/tees`, options) => fourthwallAdapter.detect(url(target), options);

  it("says yes when the 'all' collection answers with a Fourthwall product list", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(collectionPage([product()])));
    vi.stubGlobal("fetch", fetchMock);
    expect(await detect()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/collections/all.json`);
  });

  it("asks the plain origin and always about 'all', whatever was pasted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(collectionPage([])));
    vi.stubGlobal("fetch", fetchMock);
    await detect(`${ORIGIN}/en-nzd/collections/some-slug/products`);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORIGIN}/collections/all.json`);
  });

  it("says yes for an empty shop", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(collectionPage([])));
    expect(await detect()).toBe(true);
  });

  it.each([
    ["Shopify's answer", () => jsonResponse({ collection: { handle: "all", products_count: 3 } })],
    ["a missing collection", () => jsonResponse({}, { ok: false, status: 404 })],
    ["a throttled request", () => jsonResponse({}, { ok: false, status: 429 })],
    ["a list without current_page", () => jsonResponse({ products: [] })],
    ["a current_page without a list", () => jsonResponse({ current_page: 1 })],
    ["JSON that is not an object", () => jsonResponse(null)],
  ])("says no for %s", async (_, respond) => {
    vi.stubGlobal("fetch", async () => respond());
    expect(await detect()).toBe(false);
  });

  it("says no when the answer isn't JSON, or the request fails", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("x")) }));
    expect(await detect()).toBe(false);
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")));
    expect(await detect()).toBe(false);
  });

  it("makes one request and never retries, even when told to back off", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { ok: false, status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await detect()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after a few seconds and says no", async () => {
    vi.stubGlobal(
      "fetch",
      (_, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))))
    );
    const pending = detect();
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toBe(false);
  });

  it("rethrows an abort from the caller instead of saying no", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      (_, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))))
    );
    const pending = detect(`${ORIGIN}/collections/tees`, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await assertion;
  });
});
