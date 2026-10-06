// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreLensApp from "./StoreLens";
import { detectAdapter } from "@/lib/platforms";
import { product, variant } from "../lib/__fixtures__/shopify";
import { fakeShopifyFetch } from "../lib/__fixtures__/fake-shopify-fetch";
import { fakeStoresFetch } from "../lib/__fixtures__/fake-stores-fetch";
import * as fw from "../lib/__fixtures__/fourthwall";
import * as bc from "../lib/__fixtures__/bigcartel";
import { clearFeedCache } from "@/lib/platforms/bigcartel";
import { jsonResponse } from "../lib/__fixtures__/test-helpers";

// Wraps the real resolveAdapter so a test can make store resolution slow, or fail
// it, for chosen URLs. `slowResolve.override(url, options, real)` replaces the
// answer; when it is unset (or returns undefined) the real one is used.
const slowResolve = vi.hoisted(() => ({ override: null }));
vi.mock("@/lib/platforms", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveAdapter: (url, options) =>
      slowResolve.override?.(url, options, actual.resolveAdapter) ?? actual.resolveAdapter(url, options),
  };
});

// jsdom has neither observer (nor matchMedia, below); the product grid and the
// Radix controls need them.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The sidebar asks whether the viewport is desktop-sized; answer yes.
const desktopMatchMedia = (query) => ({
  matches: true,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});

const A = "shop-a.example.com";
const B = "shop-b.example.com";

// Small synthetic catalogs: every product is in stock, so the default
// "in stock only" filter never hides one. Prices differ, because the sidebar's
// price slider computes "NaN%" when every product costs the same, which jsdom's
// CSS parser rejects (a browser just ignores it).
let nextPrice = 10;
const item = (title, vendor) =>
  product({
    title,
    handle: title.toLowerCase().replace(/ /g, "-"),
    vendor,
    variants: [variant({ price: `${nextPrice++}.00` })],
  });

const storeA = () => ({
  collections: {
    all: [item("Alpha Tee", "Acme"), item("Alpha Cap", "Acme"), item("Bravo Mug", "Beta Co")],
    tees: [item("Alpha Tee", "Acme"), item("Bravo Tee", "Beta Co"), item("Charlie Tee", "Acme")],
    mugs: [item("Delta Mug", "Beta Co"), item("Echo Mug", "Acme")],
  },
});
const storeB = () => ({ collections: { all: [item("Echo Hat", "Zed"), item("Foxtrot Scarf", "Zed")] } });

const heading = (shown, total) =>
  screen.findByText((_, el) => el?.textContent === `Showing ${shown} of ${total} products`, {}, { timeout: 3000 });
const titleShown = (title) => screen.queryByText(title);
const input = () => screen.getByPlaceholderText("Paste a store or collection URL");

let pushSpy;
let replaceSpy;

// Sets the address the app will read on mount, then renders it.
function openAt(path) {
  window.history.replaceState(null, "", path);
  pushSpy = vi.spyOn(window.history, "pushState");
  replaceSpy = vi.spyOn(window.history, "replaceState");
  return render(<StoreLensApp />);
}

const pushedPaths = () => pushSpy.mock.calls.map((call) => call[2]);
const replacedPaths = () => replaceSpy.mock.calls.map((call) => call[2]);
const here = () => window.location.pathname + window.location.search;

// A response the test releases by hand, to hold one request back.
function deferred() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

// Radix's Select needs these pointer/scroll methods to open in jsdom.
const radixPolyfills = {
  hasPointerCapture: () => false,
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
};

beforeEach(() => {
  Object.assign(Element.prototype, radixPolyfills);
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("matchMedia", desktopMatchMedia);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  slowResolve.override = null;
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a deep link", () => {
  it("loads the collection and applies its filters without touching the address bar", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt(`/${A}/collections/tees?vendor=Acme`);

    await heading(2, 3);
    expect(titleShown("Alpha Tee")).not.toBeNull();
    expect(titleShown("Charlie Tee")).not.toBeNull();
    expect(titleShown("Bravo Tee")).toBeNull();
    expect(here()).toBe(`/${A}/collections/tees?vendor=Acme`);
    expect(pushedPaths()).toEqual([]);
    expect(replacedPaths().filter((path) => path !== here())).toEqual([]);
  });

  it("to a bare domain auto-loads the all-products collection and replaces the entry", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    const entries = window.history.length;
    openAt(`/${A}`);

    await heading(3, 3);
    expect(window.location.pathname).toBe(`/${A}/collections/all`);
    expect(replacedPaths()).toContain(`/${A}/collections/all`);
    expect(pushedPaths()).toEqual([]);
    expect(window.history.length).toBe(entries);
  });
});

describe("a deep link with a trailing slash", () => {
  it("loads without pushing a second entry for the same page", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    const entries = window.history.length;
    openAt(`/${A}/collections/tees/`);

    await heading(3, 3);
    expect(pushedPaths()).toEqual([]);
    expect(window.history.length).toBe(entries);
  });
});

describe("a pasted store", () => {
  it("auto-loads a bare domain and pushes a history entry", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);

    await heading(3, 3);
    expect(pushedPaths()).toEqual([`/${A}/collections/all`]);
    expect(replacedPaths()).not.toContain(`/${A}/collections/all`);
  });
});

describe("Back and Forward", () => {
  it("reload the previous collection with its filters", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt(`/${A}/collections/tees?vendor=Acme`);
    await heading(2, 3);

    const user = userEvent.setup();
    await user.click(input());
    await user.clear(input());
    await user.paste(`${A}/collections/mugs`);
    await heading(2, 2);
    expect(window.location.pathname).toBe(`/${A}/collections/mugs`);
    expect(titleShown("Delta Mug")).not.toBeNull();

    act(() => window.history.back());

    await heading(2, 3);
    expect(window.location.pathname + window.location.search).toBe(`/${A}/collections/tees?vendor=Acme`);
    expect(titleShown("Bravo Tee")).toBeNull();
    expect(titleShown("Delta Mug")).toBeNull();

    act(() => window.history.forward());

    await heading(2, 2);
    expect(window.location.pathname).toBe(`/${A}/collections/mugs`);
  });
});

describe("a store that can't be opened (#35)", () => {
  it("pushes the attempted path when the failure came from a paste", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(`${A}/collections/missing`);

    expect(await screen.findByText(/That collection wasn't found/)).not.toBeNull();
    expect(pushedPaths()).toEqual([`/${A}/collections/missing`]);
  });

  it("replaces the entry when the failure came from the address bar", async () => {
    // The listing offers an all-products collection that then refuses to load.
    const refuse = (url) =>
      url.host === A && url.pathname === "/collections/all/products.json" && url.searchParams.get("limit") !== "1"
        ? jsonResponse({}, { ok: false, status: 403 })
        : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, refuse));
    openAt(`/${A}`);

    expect(await screen.findByText(/password protected or blocking access/)).not.toBeNull();
    expect(pushedPaths()).toEqual([]);
    expect(replacedPaths()).toContain(`/${A}/collections/all`);
    expect(window.location.pathname).toBe(`/${A}/collections/all`);
  });

  it("shows the info notice and no stale grid when discovery finds nothing", async () => {
    vi.stubGlobal(
      "fetch",
      fakeShopifyFetch({ [A]: storeA(), [B]: { collections: { all: [] }, listCollections: false } })
    );
    openAt(`/${A}/collections/all`);
    await heading(3, 3);
    const user = userEvent.setup();

    await user.click(input());
    await user.clear(input());
    await user.paste(B);

    expect(await screen.findByText(/couldn't automatically find an all-products collection/)).not.toBeNull();
    expect(screen.queryByText(/products$/)).toBeNull();
    expect(titleShown("Alpha Tee")).toBeNull();
    expect(screen.queryByText("Filters")).toBeNull();
    expect(pushedPaths()).toEqual([`/${B}`]);
  });
});

describe("switching stores while one is still resolving", () => {
  it("shows the second store when the first one's discovery answers late", async () => {
    const slowListing = deferred();
    const hold = (url) => (url.host === A && url.pathname === "/collections.json" ? slowListing.promise : undefined);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);
    await user.clear(input());
    await user.paste(B);
    await heading(2, 2);
    expect(titleShown("Echo Hat")).not.toBeNull();

    // A's listing finally arrives; it must not auto-load A over B.
    await act(async () => {
      slowListing.release(jsonResponse({ collections: [{ handle: "all", title: "All", products_count: 3 }] }));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(titleShown("Echo Hat")).not.toBeNull();
    expect(titleShown("Alpha Tee")).toBeNull();
    expect(window.location.pathname).toBe(`/${B}/collections/all`);
    // Nor is A's abandoned discovery recorded as a store the user visited.
    expect(JSON.parse(window.localStorage.getItem("storelens-url-history"))).toEqual([`https://${B}`]);
  });

  it("ignores a collection that answers late after Back/Forward moved on", async () => {
    const slowCollection = deferred();
    const hold = (url) =>
      url.host === A && url.pathname === "/collections/tees/products.json" ? slowCollection.promise : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold));
    openAt(`/${A}/collections/tees`);
    // The header disables the store box while a collection is loading.
    await waitFor(() => expect(input().disabled).toBe(true));

    act(() => {
      window.history.pushState(null, "", `/${B}/collections/all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await heading(2, 2);

    await act(async () => {
      slowCollection.release(jsonResponse({ products: storeA().collections.tees }));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(titleShown("Echo Hat")).not.toBeNull();
    expect(titleShown("Bravo Tee")).toBeNull();
    expect(window.location.pathname).toBe(`/${B}/collections/all`);
  });
});

describe("switching stores when the abandoned request is aborted (rejects)", () => {
  // The same situations as above, with a fetch that behaves like a real one: the
  // request rejects with an AbortError the moment its signal aborts.
  const never = () => new Promise(() => {});

  it("shows the second store, with no error, when the first one's discovery is aborted", async () => {
    const hold = (url) => (url.host === A && url.pathname === "/collections.json" ? never() : undefined);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold, { honorAbort: true }));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);
    await user.clear(input());
    await user.paste(B);
    await heading(2, 2);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(titleShown("Echo Hat")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.location.pathname).toBe(`/${B}/collections/all`);
    expect(JSON.parse(window.localStorage.getItem("storelens-url-history"))).toEqual([`https://${B}`]);
  });

  it("shows the second store, with no error, when a collection is aborted by Back/Forward", async () => {
    const hold = (url) => (url.host === A && url.pathname === "/collections/tees/products.json" ? never() : undefined);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold, { honorAbort: true }));
    openAt(`/${A}/collections/tees`);
    await waitFor(() => expect(input().disabled).toBe(true));

    act(() => {
      window.history.pushState(null, "", `/${B}/collections/all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await heading(2, 2);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(titleShown("Echo Hat")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.location.pathname).toBe(`/${B}/collections/all`);
  });
});

describe("store resolution that takes a while", () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const slowFor = (host, wait) => (url, options, real) =>
    url.host === host ? sleep(wait).then(() => real(url, options)) : undefined;
  const aborted = () => new DOMException("The operation was aborted.", "AbortError");

  it("lets a later paste win, and the earlier store changes nothing when it finally resolves", async () => {
    const slowA = deferred();
    // A resolver that ignores its signal, so the page itself must drop the late answer.
    slowResolve.override = (url) => (url.host === A ? slowA.promise.then(() => detectAdapter(url)) : undefined);
    const fetchMock = fakeShopifyFetch({ [A]: storeA(), [B]: storeB() });
    vi.stubGlobal("fetch", fetchMock);
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);
    await user.clear(input());
    await user.paste(B);
    await heading(2, 2);

    await act(async () => slowA.release());
    await sleep(50);

    expect(titleShown("Echo Hat")).not.toBeNull();
    expect(titleShown("Alpha Tee")).toBeNull();
    expect(window.location.pathname).toBe(`/${B}/collections/all`);
    expect(pushedPaths()).toEqual([`/${B}/collections/all`]);
    expect(fetchMock.calls.filter((url) => url.host === A)).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("storelens-url-history"))).toEqual([`https://${B}`]);
  });

  it("ignores an earlier resolution that is aborted and rejects, without an error", async () => {
    slowResolve.override = (url, options, real) =>
      url.host === A
        ? new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(aborted())))
        : real(url, options);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);
    await user.clear(input());
    await user.paste(B);
    await heading(2, 2);
    await sleep(50);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.location.pathname).toBe(`/${B}/collections/all`);
  });

  it("a deep link still applies its filters after resolving slowly", async () => {
    slowResolve.override = slowFor(A, 30);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt(`/${A}/collections/tees?vendor=Acme`);

    await heading(2, 3);
    expect(titleShown("Bravo Tee")).toBeNull();
    expect(here()).toBe(`/${A}/collections/tees?vendor=Acme`);
    expect(pushedPaths()).toEqual([]);
  });

  it("a bare-domain deep link still replaces its entry after resolving slowly", async () => {
    slowResolve.override = slowFor(A, 30);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt(`/${A}`);

    await heading(3, 3);
    expect(replacedPaths()).toContain(`/${A}/collections/all`);
    expect(pushedPaths()).toEqual([]);
  });

  it("a failed deep link still replaces rather than pushes after resolving slowly", async () => {
    slowResolve.override = slowFor(A, 30);
    const refuse = (url) =>
      url.host === A && url.pathname === "/collections/all/products.json" && url.searchParams.get("limit") !== "1"
        ? jsonResponse({}, { ok: false, status: 403 })
        : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, refuse));
    openAt(`/${A}`);

    expect(await screen.findByText(/password protected or blocking access/)).not.toBeNull();
    expect(pushedPaths()).toEqual([]);
    expect(replacedPaths()).toContain(`/${A}/collections/all`);
  });

  it("shows the error when resolving fails for a reason other than being superseded", async () => {
    slowResolve.override = (url, options, real) =>
      url.host === A ? Promise.reject(new TypeError("Failed to fetch")) : real(url, options);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);

    expect(await screen.findByText("Failed to fetch")).not.toBeNull();
  });
});

describe("a collection that fails part-way", () => {
  it("keeps the products already loaded and warns about the rest", async () => {
    // A full first page (250) means a second is requested; that one can't be reached.
    const many = Array.from({ length: 250 }, (_, i) => item(`Item ${i + 1}`, "Acme"));
    const failPage2 = (url) => {
      if (url.host === A && url.pathname === "/collections/big/products.json" && url.searchParams.get("page") === "2") {
        throw new TypeError("Failed to fetch");
      }
    };
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: { collections: { big: many } } }, failPage2));
    openAt(`/${A}/collections/big`);

    expect(
      await screen.findByText("Loaded 250 products, but couldn't fetch the rest (the store couldn't be reached).", {}, { timeout: 3000 })
    ).not.toBeNull();
    await heading(250, 250);
  });
});

describe("a Fourthwall shop", () => {
  const F = "merch.example.com";
  const fwItem = (title, price) =>
    fw.product({ title, handle: title.toLowerCase().replace(/ /g, "-"), price, variants: [fw.variant("S", { cents: price * 100 }), fw.variant("M", { cents: price * 100 })] });
  const shop = () => ({
    collections: {
      all: [fwItem("Echo Tee", 20), fwItem("Foxtrot Hoodie", 40), fwItem("Golf Cap", 15)],
      tees: [fwItem("Echo Tee", 20), fwItem("Hotel Tee", 25)],
    },
  });
  const stub = (stores, override, options) => {
    const fetchMock = fakeStoresFetch(stores, override, options);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const detectionCalls = (fetchMock, host) =>
    fetchMock.calls.filter((u) => u.host === host && u.pathname === "/collections/all.json");
  const platformCache = (host) => JSON.parse(window.localStorage.getItem(`storelens:platform:v1:https://${host}`) ?? "null");

  it("is recognised from a bare domain, loads 'all', and hides what Fourthwall can't supply", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(F);

    await heading(3, 3);
    expect(titleShown("Echo Tee")).not.toBeNull();
    expect(pushedPaths()).toEqual([`/${F}/collections/all`]);
    // The collection dropdown stays (offering All Products), beside the sort control,
    // and none of the filters Fourthwall has no data for are shown.
    const [collectionSelect] = screen.getAllByRole("combobox");
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(collectionSelect.textContent).toBe("All Products");
    expect(screen.queryByText("Vendor")).toBeNull();
    expect(screen.queryByText("Tags")).toBeNull();
    expect(screen.queryByText("Product Type")).toBeNull();
  });

  it("explains in the collection dropdown why only All Products is offered", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt(`/${F}`);
    await heading(3, 3);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("combobox")[0]);

    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All Products",
      "Fourthwall doesn't let StoreLens list a shop's collections. To view another, paste its link.",
    ]);
    expect(options[0].getAttribute("aria-disabled")).not.toBe("true");
    expect(options[1].getAttribute("aria-disabled")).toBe("true");
  });

  it("offers the collection in the link and All Products, and switches between them", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt(`/${F}/collections/tees`);
    await heading(2, 2);
    const user = userEvent.setup();

    const trigger = screen.getAllByRole("combobox")[0];
    expect(trigger.textContent).toBe("Tees");
    await user.click(trigger);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent).slice(0, 2).sort()).toEqual(["All Products", "Tees"]);

    await user.click(options.find((o) => o.textContent === "All Products"));

    await heading(3, 3);
    expect(window.location.pathname).toBe(`/${F}/collections/all`);
    expect(titleShown("Golf Cap")).not.toBeNull();
  });

  describe("remembering the collections that were opened", () => {
    const visited = () => JSON.parse(window.localStorage.getItem("storelens:visited-collections:v1") ?? "{}");
    const optionTexts = async (user) => {
      await user.click(screen.getAllByRole("combobox")[0]);
      return (await screen.findAllByRole("option")).map((o) => o.textContent);
    };

    it("offers a collection opened earlier the next time the shop is opened", async () => {
      stub({ fourthwall: { [F]: shop() } });
      openAt(`/${F}/collections/tees`);
      await heading(2, 2);
      expect(visited()).toEqual({ [`https://${F}`]: ["tees"] });

      cleanup();
      openAt(`/${F}`);
      await heading(3, 3);
      const options = await optionTexts(userEvent.setup());
      expect(options.slice(0, 2)).toEqual(["All Products", "Tees"]);
      expect(options.at(-1)).toMatch(/list a shop's collections/);
    });

    it("lets the user go straight to a remembered collection", async () => {
      stub({ fourthwall: { [F]: shop() } });
      openAt(`/${F}/collections/tees`);
      await heading(2, 2);
      cleanup();
      openAt(`/${F}`);
      await heading(3, 3);
      const user = userEvent.setup();

      await user.click(screen.getAllByRole("combobox")[0]);
      await user.click((await screen.findAllByRole("option")).find((o) => o.textContent === "Tees"));

      await heading(2, 2);
      expect(window.location.pathname).toBe(`/${F}/collections/tees`);
    });

    it("does not remember All Products, which is always offered", async () => {
      stub({ fourthwall: { [F]: shop() } });
      openAt(`/${F}/collections/all`);
      await heading(3, 3);
      expect(visited()).toEqual({});
    });

    it("shares collections between a shop's locales", async () => {
      stub({ fourthwall: { [F]: shop() } });
      openAt(`/${F}/en-nzd/collections/tees`);
      await heading(2, 2);
      cleanup();
      openAt(`/${F}/en-usd`);
      await heading(3, 3);
      expect((await optionTexts(userEvent.setup())).slice(0, 2)).toEqual(["All Products", "Tees"]);
    });

    it("stops offering a collection once it no longer loads", async () => {
      window.localStorage.setItem("storelens:visited-collections:v1", JSON.stringify({ [`https://${F}`]: ["gone", "tees"] }));
      stub({ fourthwall: { [F]: shop() } });
      openAt(`/${F}/collections/gone`);

      expect(await screen.findByText(/That collection wasn't found/)).not.toBeNull();
      expect(visited()).toEqual({ [`https://${F}`]: ["tees"] });
    });

    it("keeps a collection when it fails to load for a reason other than not existing", async () => {
      const key = "storelens:visited-collections:v1";
      window.localStorage.setItem(key, JSON.stringify({ [`https://${F}`]: ["tees"] }));
      stub({ fourthwall: { [F]: shop() } }, (url) =>
        url.host === F && url.pathname === "/collections/tees/1.json" ? jsonResponse({}, { ok: false, status: 403 }) : undefined
      );
      openAt(`/${F}/collections/tees`);

      expect(await screen.findByText(/password protected or blocking access/)).not.toBeNull();
      expect(visited()).toEqual({ [`https://${F}`]: ["tees"] });
    });

    it("is not used for a Shopify store, which lists its own collections", async () => {
      vi.stubGlobal("fetch", fakeStoresFetch({ shopify: { [A]: storeA() } }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      expect(visited()).toEqual({});
    });
  });

  it("is recognised from a deep link on a custom domain, and keeps the address as it was", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt(`/${F}/collections/tees?q=hotel`);

    await heading(1, 2);
    expect(titleShown("Hotel Tee")).not.toBeNull();
    expect(titleShown("Echo Tee")).toBeNull();
    expect(here()).toBe(`/${F}/collections/tees?q=hotel`);
    expect(pushedPaths()).toEqual([]);
  });

  it("loads a pasted /collections/all/products URL with a locale, and links products on it", async () => {
    const fetchMock = stub({ fourthwall: { [F]: shop() } });
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(`https://${F}/en-nzd/collections/all/products`);

    await heading(3, 3);
    expect(input().value).toBe(`${F}/en-nzd`);
    expect(fetchMock.calls.some((u) => u.pathname === "/en-nzd/collections/all/1.json")).toBe(true);
    expect(document.querySelector('a[href^="https://merch.example.com/en-nzd/products/"]')).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem("storelens-url-history"))).toEqual([`https://${F}/en-nzd`]);
  });

  it("says its option names are guessed, and the notice can be dismissed", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt(`/${F}/collections/all`);
    await heading(3, 3);

    const notice = await screen.findByText(/Fourthwall doesn't name variant options/);
    expect(notice).not.toBeNull();
    await userEvent.setup().click(within(notice.closest('[role="alert"]')).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Fourthwall doesn't name variant options/)).toBeNull();
  });

  it("filters by the guessed 'Size' option", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt(`/${F}/collections/all`);
    await heading(3, 3);
    expect(screen.getAllByText("Size").length).toBeGreaterThan(0);
  });

  it("reports a missing collection as not found, without naming another platform", async () => {
    stub({ fourthwall: { [F]: shop() } });
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(`${F}/collections/nope`);

    const message = await screen.findByText(/That collection wasn't found/);
    expect(message.textContent).not.toMatch(/shopify/i);
    expect(pushedPaths()).toEqual([`/${F}/collections/nope`]);
  });

  it("remembers the platform after a load, and skips the check next time", async () => {
    const fetchMock = stub({ fourthwall: { [F]: shop() } });
    openAt(`/${F}/collections/all`);
    await heading(3, 3);
    expect(platformCache(F).platformId).toBe("fourthwall");
    expect(detectionCalls(fetchMock, F)).toHaveLength(1);

    cleanup();
    openAt(`/${F}/collections/tees`);
    await heading(2, 2);
    expect(detectionCalls(fetchMock, F)).toHaveLength(1);
  });

  it("forgets the remembered platform when a load fails", async () => {
    stub({ fourthwall: { [F]: shop() } });
    window.localStorage.setItem(`storelens:platform:v1:https://${F}`, JSON.stringify({ platformId: "fourthwall", cachedAt: Date.now() }));
    openAt(`/${F}/collections/nope`);

    expect(await screen.findByText(/That collection wasn't found/)).not.toBeNull();
    expect(platformCache(F)).toBeNull();
  });

  it("shows what was pasted straight away while the platform is still being worked out", async () => {
    const release = deferred();
    slowResolve.override = (url, options, real) => (url.host === F ? release.promise.then(() => real(url, options)) : undefined);
    stub({ fourthwall: { [F]: shop() } });
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(F);
    expect(input().value).toBe(F);
    expect(screen.queryByText(/Showing/)).toBeNull();

    await act(async () => release.release());
    await heading(3, 3);
  });

  it("loads a big shop a few pages at a time with a running count, and keeps what loaded if a page fails", async () => {
    const big = Array.from({ length: 300 }, (_, i) => fwItem(`Item ${i + 1}`, 10 + (i % 30)));
    const failPage = (url) => {
      if (url.host === F && url.pathname === "/collections/all/10.json") throw new TypeError("Failed to fetch");
    };
    stub({ fourthwall: { [F]: { collections: { all: big } } } }, failPage);
    openAt(`/${F}/collections/all`);

    expect(
      await screen.findByText("Loaded 180 products, but couldn't fetch the rest (the store couldn't be reached).", {}, { timeout: 4000 })
    ).not.toBeNull();
    await heading(180, 180);
  });
});

describe("a Shopify store next to Fourthwall", () => {
  it("is still recognised as Shopify, and remembered once it loads", async () => {
    const fetchMock = fakeStoresFetch({ shopify: { [A]: storeA() } });
    vi.stubGlobal("fetch", fetchMock);
    openAt(`/${A}/collections/tees`);

    await heading(3, 3);
    expect(fetchMock.calls.filter((u) => u.host === A && u.pathname === "/collections/all.json")).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(`storelens:platform:v1:https://${A}`)).platformId).toBe("shopify");
    // Its own controls are still there: the collection dropdown and the sort,
    // and no Fourthwall-style explanation in the collection list.
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    await userEvent.setup().click(screen.getAllByRole("combobox")[0]);
    expect((await screen.findAllByRole("option")).some((o) => /list a shop's collections/.test(o.textContent))).toBe(false);

    cleanup();
    openAt(`/${A}/collections/mugs`);
    await heading(2, 2);
    expect(fetchMock.calls.filter((u) => u.host === A && u.pathname === "/collections/all.json")).toHaveLength(1);
  });

  it("is not mistaken for Fourthwall when the shop has no 'all' collection", async () => {
    vi.stubGlobal("fetch", fakeStoresFetch({ shopify: { [A]: { collections: { tees: storeA().collections.tees } } } }));
    openAt(`/${A}/collections/tees`);
    await heading(3, 3);
  });
});

describe("a Big Cartel shop", () => {
  const BC = "example-shop.bigcartel.com";
  const tees = bc.category("Tees");
  const mugs = bc.category("Mugs");
  const bcItem = (name, price, extra = {}) =>
    bc.product({ name, permalink: name.toLowerCase().replace(/ /g, "-"), price, default_price: price, options: [bc.option("Default", { price })], ...extra });
  const feed = () => [
    bcItem("Echo Tee", 20, { categories: [tees], artists: [{ id: 1, name: "Ann Artist" }] }),
    bcItem("Foxtrot Tee", 25, { categories: [tees] }),
    bcItem("Golf Mug", 15, { categories: [mugs] }),
    bcItem("Hotel Mug", 12, { categories: [mugs] }),
  ];
  const stub = (bigcartel, override, options) => {
    const fetchMock = fakeStoresFetch({ bigcartel }, override, options);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  beforeEach(clearFeedCache);

  it("is recognised from its address with no network check, and a bare domain loads all products", async () => {
    const fetchMock = stub({ "example-shop": feed() });
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(BC);

    await heading(4, 4);
    expect(pushedPaths()).toEqual([`/${BC}/products`]);
    expect(fetchMock.calls.map((u) => u.host)).toEqual(["api.bigcartel.com"]);
    expect(fetchMock.calls).toHaveLength(1);
    expect(screen.getAllByRole("combobox")[0].textContent).toBe("All Products (4)");
  });

  it("lists the shop's categories in the dropdown and switches between them", async () => {
    stub({ "example-shop": feed() });
    openAt(`/${BC}`);
    await heading(4, 4);
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("combobox")[0]);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["All Products (4)", "Mugs (2)", "Tees (2)"]);

    await user.click(options.find((o) => o.textContent.startsWith("Tees")));

    await heading(2, 2);
    expect(window.location.pathname).toBe(`/${BC}/category/tees`);
    expect(titleShown("Golf Mug")).toBeNull();
  });

  it("opens a category deep link", async () => {
    stub({ "example-shop": feed() });
    openAt(`/${BC}/category/mugs`);
    await heading(2, 2);
    expect(titleShown("Golf Mug")).not.toBeNull();
    expect(pushedPaths()).toEqual([]);
  });

  it("shows Artists for the vendor filter, hides tags, and shows the category filter", async () => {
    stub({ "example-shop": feed() });
    openAt(`/${BC}`);
    await heading(4, 4);
    expect(screen.getByText("Artists")).not.toBeNull();
    expect(screen.getByText("Category")).not.toBeNull();
    expect(screen.queryByText("Vendor")).toBeNull();
    expect(screen.queryByText("Tags")).toBeNull();
  });

  it("explains a category the shop doesn't have", async () => {
    stub({ "example-shop": feed() });
    openAt(`/${BC}/category/nope`);
    expect(await screen.findByText(/That collection wasn't found/, {}, { timeout: 3000 })).not.toBeNull();
  });

  it("explains a locked shop", async () => {
    stub({ "example-shop": feed() }, undefined, { locked: ["example-shop"] });
    openAt(`/${BC}`);
    expect(await screen.findByText(/This store is locked/, {}, { timeout: 3000 })).not.toBeNull();
  });

  it("says what a Big Cartel shop on its own domain would run into, without claiming this one is Big Cartel", async () => {
    stub({});
    openAt("/shop.example.com");
    expect(await screen.findByText(/Couldn't reach this store/, {}, { timeout: 3000 })).not.toBeNull();
    expect(screen.getByText(/If this is a Big Cartel shop, sorry: StoreLens can only read ones at a shopname\.bigcartel\.com address, not on their own domain\./)).not.toBeNull();
  });

  it("explains a closed shop", async () => {
    stub({});
    openAt(`/${BC}`);
    expect(await screen.findByText(/wasn't found/, {}, { timeout: 3000 })).not.toBeNull();
  });
});
