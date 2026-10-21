// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreLensApp from "./StoreLens";
import { detectAdapter } from "@/lib/platforms";
import { shopifyAdapter } from "@/lib/platforms/shopify";
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

// Lets everything already in flight finish: after a macrotask turn every promise
// chain that isn't waiting on a timer has settled, and act() has rendered the
// result. Use it instead of a fixed sleep before asserting that something did NOT
// happen, so the assertion runs after the late work has landed, not after a guess
// at how long it takes. (Run twice: a settled chain can start another.)
const drain = async () => {
  for (let i = 0; i < 2; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

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
  // Module-level state that would otherwise carry over from the previous test: the
  // Big Cartel feed cache and the price counter the catalogs draw from.
  clearFeedCache();
  nextPrice = 10;
});

afterEach(() => {
  slowResolve.override = null;
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the collection dropdown (#65)", () => {
  it("stays controlled while loading a collection and switching stores, and shows the placeholder only with no selection", async () => {
    const logged = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    for (const spy of logged) spy.mockImplementation(() => {});
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }));
    openAt("/");
    const user = userEvent.setup();
    expect(screen.getAllByRole("combobox")[0].hasAttribute("data-placeholder")).toBe(true);

    await user.click(input());
    await user.paste(`${A}/collections/tees`);
    await heading(3, 3);
    expect(screen.getAllByRole("combobox")[0].hasAttribute("data-placeholder")).toBe(false);

    await user.click(input());
    await user.clear(input());
    await user.paste(B);
    await heading(2, 2);

    const warnings = logged.flatMap((spy) => spy.mock.calls).filter((call) => /controlled/i.test(call.join(" ")));
    expect(warnings).toEqual([]);
  });
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

  it("keep the filters in the address while the collection reloads (#48)", async () => {
    // Back lands on an entry whose collection is still loading. The previous
    // collection's debounced address write (300 ms) comes due in that window, and
    // must not overwrite the entry's filters with the previous collection's.
    const slowTees = deferred();
    let teesLoads = 0;
    const hold = (url) => {
      if (url.host === A && url.pathname === "/collections/tees/products.json" && ++teesLoads > 1) return slowTees.promise;
    };
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, hold));
    // Fake timers that also follow the real clock (the testing library's waits need
    // that), so the debounce window passes by advancing the clock, not by sleeping.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openAt(`/${A}/collections/tees?vendor=Acme`);
    await heading(2, 3);

    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await user.click(input());
    await user.clear(input());
    await user.paste(`${A}/collections/mugs`);
    await heading(2, 2);

    act(() => window.history.back());
    await waitFor(() => expect(teesLoads).toBe(2));
    await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
    expect(here()).toBe(`/${A}/collections/tees?vendor=Acme`);

    await act(async () => slowTees.release(await fakeShopifyFetch({ [A]: storeA() })(`https://${A}/collections/tees/products.json`)));
    await heading(2, 3);
    expect(here()).toBe(`/${A}/collections/tees?vendor=Acme`);
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
    // A fetch that ignores its signal, so the answer really does arrive late.
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold, { honorAbort: false }));
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
    await drain();

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
    // A fetch that ignores its signal, so the answer really does arrive late.
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold, { honorAbort: false }));
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
    await drain();

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
    await drain();

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
    await drain();

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
    await drain();

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
    await drain();

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

  it("offers the retry button after a partial collection list, and a retry fetches a fresh one", async () => {
    // Only probing can find this store's collections, and the first probe is rate limited.
    let limited = true;
    const probe = (url) =>
      limited && url.pathname === "/collections/all/products.json" && url.searchParams.get("limit") === "1"
        ? jsonResponse({}, { ok: false, status: 429 })
        : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: { ...storeA(), listCollections: false } }, probe));
    openAt(`/${A}`);
    const user = userEvent.setup();

    const retry = await screen.findByTitle("Retry loading collections");
    expect(screen.getByText(/may be incomplete/)).not.toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("storelens:collections:"))).toEqual([]);

    limited = false;
    await user.click(retry);
    await waitFor(() => expect(screen.queryByTitle("Retry loading collections")).toBeNull());
    expect(Object.keys(localStorage).filter((k) => k.startsWith("storelens:collections:"))).toHaveLength(1);
  });

  it("opens all-products when a retry succeeds after the discovery that was waiting to open it failed", async () => {
    let failing = true;
    const down = (url) =>
      failing && url.host === A && (url.pathname === "/collections.json" || url.searchParams.get("limit") === "1")
        ? jsonResponse({}, { ok: false, status: 429 })
        : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, down));
    openAt(`/${A}`);
    const user = userEvent.setup();

    const retry = await screen.findByTitle("Retry loading collections", {}, { timeout: 10000 });
    expect(titleShown("Alpha Tee")).toBeNull();

    failing = false;
    await user.click(retry);
    expect(await heading(3, 3)).not.toBeNull();
    expect(titleShown("Alpha Tee")).not.toBeNull();
  });

  it("retries only the store on screen: after store A's discovery failed and B's did too, retry opens B's all-products and nothing from A", async () => {
    let failing = true;
    const down = (url) =>
      failing && (url.pathname === "/collections.json" || url.searchParams.get("limit") === "1")
        ? jsonResponse({}, { ok: false, status: 429 })
        : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, down));
    openAt(`/${A}`);
    const user = userEvent.setup();
    await screen.findByTitle("Retry loading collections", {}, { timeout: 10000 });

    await user.click(input());
    await user.paste(B);
    await user.keyboard("{Enter}");
    // B fails too (the retry button is still there, now for B).
    await screen.findByDisplayValue(B);
    await screen.findByTitle("Retry loading collections", {}, { timeout: 10000 });

    failing = false;
    await user.click(screen.getByTitle("Retry loading collections"));
    expect(await heading(2, 2)).not.toBeNull();
    expect(titleShown("Echo Hat")).not.toBeNull();
    expect(titleShown("Alpha Tee")).toBeNull();
    expect(input().value).toBe(B);
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
    // (Fourthwall's products never carry vendors or tags, so this alone can't show
    // the capability check works; "sections the platform has no data for", below,
    // does, with products that do have them.)
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


  it("is recognised from its address with no network check, and a bare domain loads all products", async () => {
    const fetchMock = stub({ "example-shop": feed() });
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(BC);

    await heading(4, 4);
    expect(pushedPaths()).toEqual([`/${BC}/products`]);
    // The products and the shop's store info, both from the feed host, once each.
    expect(fetchMock.calls.map((u) => u.href).sort()).toEqual([
      "https://api.bigcartel.com/example-shop/products.json",
      "https://api.bigcartel.com/example-shop/store.json",
    ]);
    expect(screen.getAllByRole("combobox")[0].textContent).toBe("All Products (4)");
  });

  describe("prices", () => {
    const shownPrices = () => screen.getAllByText(/^[^\d\s]*\d+\.\d{2}(\s[A-Z]{3})?$/).map((el) => el.textContent);

    it("are shown in the shop's own currency", async () => {
      stub({ "example-shop": feed() }, undefined, { stores: { "example-shop": { currency: "EUR" } } });
      openAt(`/${BC}`);
      await heading(4, 4);
      expect(shownPrices().sort()).toEqual(["€12.00\u00a0EUR", "€15.00\u00a0EUR", "€20.00\u00a0EUR", "€25.00\u00a0EUR"]);
    });

    it("fall back to $ when store.json can't be read, and the products still load", async () => {
      stub({ "example-shop": feed() }, undefined, { stores: { "example-shop": null } });
      openAt(`/${BC}`);
      await heading(4, 4);
      expect(shownPrices().sort()).toEqual(["$12.00", "$15.00", "$20.00", "$25.00"]);
    });
  });

  it("warns that the shop is larger than what loaded when its store.json says it has more", async () => {
    stub({ "example-shop": feed() }, undefined, { stores: { "example-shop": { products_count: 250 } } });
    openAt(`/${BC}`);
    await heading(4, 4);
    expect(
      await screen.findByText("This collection is larger than StoreLens can load from Big Cartel — showing the first 4 products.")
    ).not.toBeNull();
  });

  it("does not warn when store.json agrees with what loaded", async () => {
    stub({ "example-shop": feed() });
    openAt(`/${BC}`);
    await heading(4, 4);
    expect(screen.queryByText(/larger than StoreLens can load/)).toBeNull();
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
    expect(await screen.findByText(/That store wasn't found/, {}, { timeout: 3000 })).not.toBeNull();
    expect(screen.queryByText(/dropdown/)).toBeNull();
  });
});

// The address bar and Recent Stores while collections load, switch and fail (#82).
describe("history writes and load cancellation (#82)", () => {
  // The address write is debounced by 300 ms, so these tests run on fake timers
  // that also follow the real clock (the testing library's own waits need that).
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Moves the clock in small steps, letting React render between them as it
  // would in a browser (inside one act() it would only render at the end).
  const settle = async (ms = 450) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 25) {
      await act(async () => void (await vi.advanceTimersByTimeAsync(25)));
    }
  };
  const userWithTimers = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  // Moves the address bar as Back/Forward would, and tells the app.
  const goTo = (path) =>
    act(() => {
      window.history.pushState(null, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  const productsOf = (collection) => ({ products: collection });
  const priceOf = (rawProduct) => Number(rawProduct.variants[0].price);
  const savedHistory = () => JSON.parse(window.localStorage.getItem("storelens-url-history"));
  const holdCollection = (host, handle, promise, { after = 0 } = {}) => {
    let seen = 0;
    return (url) =>
      url.host === host && url.pathname === `/collections/${handle}/products.json` && ++seen > after ? promise : undefined;
  };

  describe("the debounced address write (H1)", () => {
    it("writes the filters 300 ms after the last change, and not before", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      const user = userWithTimers();

      await user.click(screen.getByRole("checkbox", { name: "Acme" }));
      await settle(100);
      expect(here()).toBe(`/${A}/collections/tees`);

      await user.click(screen.getByRole("checkbox", { name: "Beta Co" }));
      await settle(250);
      expect(here()).toBe(`/${A}/collections/tees`);

      await settle(100);
      expect(here()).toBe(`/${A}/collections/tees?vendor=Acme&vendor=Beta+Co`);
    });
  });

  describe("switching collections in the same store (A1)", () => {
    it("keeps the price filter on the old entry while the new collection loads", async () => {
      const store = storeA();
      const prices = store.collections.tees.map(priceOf).sort((a, b) => a - b);
      const range = `?minPrice=${prices[0]}&maxPrice=${prices[1]}`;
      const slowMugs = deferred();
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: store }, holdCollection(A, "mugs", slowMugs.promise)));
      openAt(`/${A}/collections/tees${range}`);
      await heading(2, 3);
      const user = userWithTimers();

      await user.click(input());
      await user.clear(input());
      await user.paste(`${A}/collections/mugs`);
      await settle();
      expect(here()).toBe(`/${A}/collections/tees${range}`);

      await act(async () => slowMugs.release(jsonResponse(productsOf(store.collections.mugs))));
      await heading(2, 2);
      await settle();
      expect(here()).toBe(`/${A}/collections/mugs`);

      act(() => window.history.back());
      await heading(2, 3);
      await settle();
      expect(here()).toBe(`/${A}/collections/tees${range}`);
    });
  });

  describe("Back and Forward onto an entry while its store is still resolving (A1)", () => {
    // tees (no filters) -> mugs, a filter ticked, then Back before the 300 ms
    // write has run: the entry Back lands on must not receive mugs' filters.
    async function ticksFilterThenGoesBack(override) {
      const store = storeA();
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: store }, override, { honorAbort: true }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      const user = userWithTimers();
      await user.click(input());
      await user.clear(input());
      await user.paste(`${A}/collections/mugs`);
      await heading(2, 2);
      await settle();

      const resolution = deferred();
      slowResolve.override = (url) => (url.host === A ? resolution.promise.then(() => detectAdapter(url)) : undefined);
      await user.click(screen.getByRole("checkbox", { name: "Acme" }));
      act(() => window.history.back());
      await settle();
      return { store, resolution };
    }

    it("does not write the previous collection's filters onto an entry that had none", async () => {
      const { resolution } = await ticksFilterThenGoesBack();
      expect(here()).toBe(`/${A}/collections/tees`);

      await act(async () => resolution.release());
      await heading(3, 3);
      await settle();
      expect(here()).toBe(`/${A}/collections/tees`);
    });

    it("leaves the entry as it was when that collection then fails to load", async () => {
      const refuse = holdCollection(A, "tees", Promise.resolve(jsonResponse({}, { ok: false, status: 403 })), { after: 1 });
      const { resolution } = await ticksFilterThenGoesBack(refuse);

      await act(async () => resolution.release());
      expect(await screen.findByText(/password protected or blocking access/)).not.toBeNull();
      await settle();
      expect(here()).toBe(`/${A}/collections/tees`);
    });

    it("leaves the entry as it was when its store can't be resolved", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      const user = userWithTimers();
      await user.click(input());
      await user.clear(input());
      await user.paste(`${A}/collections/mugs`);
      await heading(2, 2);
      await settle();

      const resolution = deferred();
      slowResolve.override = (url) =>
        url.host === A
          ? resolution.promise.then(() => {
              throw new TypeError("Failed to fetch");
            })
          : undefined;
      await user.click(screen.getByRole("checkbox", { name: "Acme" }));
      act(() => window.history.back());
      await act(async () => resolution.release());
      expect(await screen.findByText("Failed to fetch")).not.toBeNull();
      await settle();
      expect(here()).toBe(`/${A}/collections/tees`);
    });
  });

  describe("the sort (A4)", () => {
    it("is not added to an entry that didn't have one when Back returns to it", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      await goTo(`/${A}/collections/mugs?sort=price-asc`);
      await heading(2, 2);
      await settle();
      expect(here()).toBe(`/${A}/collections/mugs?sort=price-asc`);

      act(() => window.history.back());
      await heading(3, 3);
      await settle();
      expect(here()).toBe(`/${A}/collections/tees`);
    });

    it("is still kept when the user switches collection", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      openAt(`/${A}/collections/mugs?sort=price-asc`);
      await heading(2, 2);
      const user = userWithTimers();

      await user.click(input());
      await user.clear(input());
      await user.paste(`${A}/collections/tees`);
      await heading(3, 3);
      await settle();
      expect(here()).toBe(`/${A}/collections/tees?sort=price-asc`);
    });
  });

  describe("a deep link to a non-canonical path (A2)", () => {
    it("is normalised in place, without a second history entry", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      const entries = window.history.length;
      openAt(`/${A}/collections/tees/products/alpha-tee?vendor=Acme`);

      await heading(2, 3);
      await settle();
      expect(pushedPaths()).toEqual([]);
      expect(window.history.length).toBe(entries);
      expect(here()).toBe(`/${A}/collections/tees?vendor=Acme`);
    });
  });

  describe("Back to a non-canonical entry of the collection already on screen (A2)", () => {
    it("is normalised in place too", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      const entries = window.history.length;

      await goTo(`/${A}/collections/tees/products/alpha-tee`);
      await settle();
      expect(here()).toBe(`/${A}/collections/tees`);
      expect(pushedPaths()).toEqual([`/${A}/collections/tees/products/alpha-tee`]);
      expect(window.history.length).toBe(entries + 1);
    });
  });

  describe("a load that is still running when the address moves on (B1, H3)", () => {
    // Starts with tees held in flight; the test then navigates and releases it.
    function holdTees(extraStores = {}, override) {
      const store = storeA();
      const slowTees = deferred();
      const hold = holdCollection(A, "tees", slowTees.promise);
      vi.stubGlobal(
        "fetch",
        fakeShopifyFetch({ [A]: store, ...extraStores }, (url) => hold(url) ?? override?.(url), { honorAbort: true })
      );
      openAt(`/${A}/collections/tees`);
      const release = () => act(async () => slowTees.release(jsonResponse(productsOf(store.collections.tees))));
      return { release };
    }

    it("is cancelled by a bare domain, which then loads its own collection", async () => {
      const slowListing = deferred();
      const { release } = holdTees({ [B]: storeB() }, (url) =>
        url.host === B && url.pathname === "/collections.json" ? slowListing.promise : undefined
      );
      await waitFor(() => expect(input().disabled).toBe(true));

      await goTo(`/${B}`);
      await release();
      await settle(50);
      expect(titleShown("Bravo Tee")).toBeNull();
      expect(here()).toBe(`/${B}`);

      await act(async () => slowListing.release(jsonResponse({ collections: [{ handle: "all", title: "All", products_count: 2 }] })));
      await heading(2, 2);
      expect(here()).toBe(`/${B}/collections/all`);
      expect(pushedPaths()).toEqual([`/${B}`]);
    });

    it("is cancelled by invalid input", async () => {
      const { release } = holdTees();
      await waitFor(() => expect(input().disabled).toBe(true));

      await goTo("/not%20a%20url");
      await release();
      await settle(50);
      expect(titleShown("Bravo Tee")).toBeNull();
      expect(screen.getByText("Please enter a valid store or collection URL")).not.toBeNull();
      expect(pushedPaths()).toEqual(["/not%20a%20url"]);
      expect(input().disabled).toBe(false);
    });

    it("is cancelled by arriving back at the empty page", async () => {
      const { release } = holdTees();
      await waitFor(() => expect(input().disabled).toBe(true));

      await goTo("/");
      await release();
      await settle(50);
      expect(titleShown("Bravo Tee")).toBeNull();
      expect(here()).toBe("/");
      expect(pushedPaths()).toEqual(["/"]);
    });

    it("cannot take the filters of the link that replaced it", async () => {
      const slowB = deferred();
      slowResolve.override = (url) => (url.host === B ? slowB.promise.then(() => detectAdapter(url)) : undefined);
      const { release } = holdTees({ [B]: storeB() });
      await waitFor(() => expect(input().disabled).toBe(true));

      await goTo(`/${B}/collections/all?vendor=Zed`);
      await release();
      await settle(50);
      expect(titleShown("Bravo Tee")).toBeNull();
      expect(here()).toBe(`/${B}/collections/all?vendor=Zed`);

      await act(async () => slowB.release());
      await heading(2, 2);
      expect(titleShown("Echo Hat")).not.toBeNull();
      expect(here()).toBe(`/${B}/collections/all?vendor=Zed`);
    });
  });

  describe("submitting input that isn't a store (B2)", () => {
    async function loadedTees() {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      return userWithTimers();
    }

    it("clears the grid, sidebar and address for invalid input", async () => {
      const user = await loadedTees();
      await user.clear(input());
      await user.type(input(), "not a url{Enter}");

      expect(screen.getByText("Please enter a valid store or collection URL")).not.toBeNull();
      expect(titleShown("Bravo Tee")).toBeNull();
      expect(screen.queryByText(/products$/)).toBeNull();
      expect(screen.queryByText("Filters")).toBeNull();
      expect(here()).toBe("/");
      expect(pushedPaths()).toEqual(["/"]);

      act(() => window.history.back());
      await heading(3, 3);
    });

    it("clears the grid, sidebar and address for an empty submit", async () => {
      const user = await loadedTees();
      await user.clear(input());
      await user.type(input(), "{Enter}");

      expect(titleShown("Bravo Tee")).toBeNull();
      expect(screen.queryByText("Filters")).toBeNull();
      expect(here()).toBe("/");
    });
  });

  describe("a bare domain pasted while the previous store's discovery is still running (B3)", () => {
    it("does not let the previous store's discovery start the new store's auto-load", async () => {
      const slowListingA = deferred();
      const slowB = deferred();
      slowResolve.override = (url) => (url.host === B ? slowB.promise.then(() => detectAdapter(url)) : undefined);
      const hold = (url) => (url.host === A && url.pathname === "/collections.json" ? slowListingA.promise : undefined);
      const fetchMock = fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold);
      vi.stubGlobal("fetch", fetchMock);
      openAt("/");
      const user = userWithTimers();
      await user.click(input());
      await user.paste(A);
      await user.clear(input());
      await user.paste(B);

      // B resolves and A's discovery answers before React has re-rendered for B.
      await act(async () => {
        slowB.release();
        for (let i = 0; i < 5; i++) await Promise.resolve();
        slowListingA.release(jsonResponse({ collections: [{ handle: "all", title: "All", products_count: 3 }] }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      await heading(2, 2);
      await settle(50);

      expect(titleShown("Echo Hat")).not.toBeNull();
      expect(fetchMock.calls.filter((url) => url.host === A && url.pathname.includes("/products.json") && url.pathname !== "/products.json")).toEqual([]);
      expect(here()).toBe(`/${B}/collections/all`);
    });
  });

  describe("Recent Stores (C5)", () => {
    it("adds a pasted collection's store as soon as it loads, before its collection list arrives", async () => {
      const slowListingB = deferred();
      const hold = (url) => (url.host === B && url.pathname === "/collections.json" ? slowListingB.promise : undefined);
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      const user = userWithTimers();

      await user.click(input());
      await user.clear(input());
      await user.paste(`${B}/collections/all`);
      await heading(2, 2);

      expect(savedHistory()).toEqual([`https://${B}`, `https://${A}`]);
    });

    it("keeps its order when Back and Forward move between stores already in it", async () => {
      vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }));
      openAt(`/${A}/collections/tees`);
      await heading(3, 3);
      const user = userWithTimers();
      await user.click(input());
      await user.clear(input());
      await user.paste(B);
      await heading(2, 2);
      expect(savedHistory()).toEqual([`https://${B}`, `https://${A}`]);

      act(() => window.history.back());
      await heading(3, 3);
      await settle(50);
      expect(savedHistory()).toEqual([`https://${B}`, `https://${A}`]);

      act(() => window.history.forward());
      await heading(2, 2);
      await settle(50);
      expect(savedHistory()).toEqual([`https://${B}`, `https://${A}`]);
    });
  });
});

describe("input and filter fixes (#84)", () => {
  const pricedStore = () => ({
    collections: {
      all: ["Low Tee:10", "Mid Tee:20", "High Tee:30"].map((entry) => {
        const [title, price] = entry.split(":");
        return product({
          title,
          handle: title.toLowerCase().replace(/ /g, "-"),
          vendor: "Acme",
          variants: [variant({ price: `${price}.00` })],
        });
      }),
    },
  });

  it("Reset restores the full price range and clears the filter count and URL params", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt(`/${A}/collections/all?minPrice=25&maxPrice=30`);
    await heading(1, 3);
    const user = userEvent.setup();

    const reset = screen.getAllByRole("button", { name: /reset/i }).find((button) => !button.disabled);
    await user.click(reset);

    await heading(3, 3);
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.getAllByRole("button", { name: /reset/i }).every((button) => button.disabled || button.className.includes("disabled"))).toBe(true);
  });

  it("shows a product with no variants instead of counting but hiding it", async () => {
    const store = pricedStore();
    store.collections.all.push(product({ title: "Mystery Item", handle: "mystery-item", vendor: "Acme", variants: [] }));
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: store }));
    openAt(`/${A}/collections/all`);

    await heading(4, 4);
    expect(titleShown("Mystery Item")).not.toBeNull();
    expect(screen.getAllByText("Price unavailable").length).toBeGreaterThan(0);
  });

  it("search ignores markup in descriptions", async () => {
    const store = pricedStore();
    store.collections.all[0].body_html = "<div><span>Soft cotton</span></div>";
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: store }));
    openAt(`/${A}/collections/all?q=span`);
    await heading(0, 3);

    cleanup();
    openAt(`/${A}/collections/all?q=cotton`);
    await heading(1, 3);
    expect(titleShown("Low Tee")).not.toBeNull();
  });

  it("an empty price range and an unknown sort in the link are ignored", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt(`/${A}/collections/all?minPrice=&maxPrice=&sort=bogus`);
    await heading(3, 3);
    expect(screen.getAllByRole("combobox").some((box) => /Title A-Z/.test(box.textContent))).toBe(true);
  });

  it("matches a vendor from a link ignoring case, in the collection's spelling", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt(`/${A}/collections/all?vendor=ACME`);
    await heading(3, 3);
    expect(screen.queryByText(/were ignored/)).toBeNull();
    await waitFor(() => expect(here()).toBe(`/${A}/collections/all?vendor=Acme`));
  });

  it("names a vendor and a tag the collection doesn't have in the warning", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt(`/${A}/collections/all?vendor=Nope&tag=nope`);
    await heading(3, 3);
    expect(screen.getByText(/were ignored \(Vendor: Nope, Tag: nope\)/)).not.toBeNull();
  });

  it("clamps a price range from a link to the collection's prices", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt(`/${A}/collections/all?minPrice=25&maxPrice=5000`);
    await heading(1, 3);
    expect(screen.queryByText(/were ignored/)).toBeNull();
  });

  it("drops a price range outside the collection's prices and says so", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt(`/${A}/collections/all?minPrice=1000&maxPrice=2000`);
    await heading(3, 3);
    expect(screen.getByText(/were ignored \(Price: 1000 - 2000\)/)).not.toBeNull();
  });

  it("starts with no Recent Stores when the saved history is not an array of strings", async () => {
    window.localStorage.setItem("storelens-url-history", JSON.stringify({ not: "an array" }));
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: pricedStore() }));
    openAt("/");
    expect(input()).not.toBeNull();
    window.localStorage.setItem("storelens-url-history", JSON.stringify([1, 2]));
    cleanup();
    openAt("/");
    expect(input()).not.toBeNull();
  });

  it("loads a bare domain starting with http", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ ["httpie.shop"]: pricedStore() }));
    openAt("/");
    const user = userEvent.setup();
    await user.click(input());
    await user.paste("httpie.shop");
    await heading(3, 3);
    expect(here()).toBe("/httpie.shop/collections/all");
  });
});

describe("the filter drawer across loads (#113)", () => {
  it("stays closed when the next collection finishes loading at mobile width", async () => {
    vi.stubGlobal("matchMedia", (query) => ({ ...desktopMatchMedia(query), matches: false }));
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }));
    openAt(`/${A}/collections/tees`);
    await waitFor(() => expect(screen.getByRole("button", { name: /^filters/i })).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^filters/i }));
    expect(screen.getByRole("dialog", { name: "Filters" }).hasAttribute("inert")).toBe(false);

    act(() => {
      window.history.pushState(null, "", `/${B}/collections/all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await heading(2, 2);

    expect(document.querySelector("aside").hasAttribute("inert")).toBe(true);
  });

  it("keeps focus in the page, not on <body>, when a load closes the drawer", async () => {
    vi.stubGlobal("matchMedia", (query) => ({ ...desktopMatchMedia(query), matches: false }));
    const slow = deferred();
    const hold = (url) => (url.host === B && url.pathname === "/collections/all/products.json" ? slow.promise : undefined);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA(), [B]: storeB() }, hold));
    openAt(`/${A}/collections/tees`);
    await waitFor(() => expect(screen.getByRole("button", { name: /^filters/i })).toBeTruthy());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^filters/i }));
    expect(document.querySelector("aside").contains(document.activeElement)).toBe(true);

    act(() => {
      window.history.pushState(null, "", `/${B}/collections/all`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    // The sidebar is gone while the next collection loads; focus must not have
    // fallen to <body> with it.
    await waitFor(() => expect(document.querySelector("aside")).toBeNull());
    expect(document.activeElement).toBe(document.querySelector("main"));
    await act(async () => {
      slow.release(jsonResponse({ products: storeB().collections.all }));
    });
    await heading(2, 2);
  });
});

describe("the page while a store resolves and after a collection fails (#112)", () => {
  const prompt = () => screen.queryByText(/store or collection URL above to get started/);
  const dropdown = () => screen.getAllByRole("combobox")[0];

  it("shows no prompt while a pasted store is resolving", async () => {
    const slow = deferred();
    slowResolve.override = (url) => (url.host === A ? slow.promise.then(() => detectAdapter(url)) : undefined);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt("/");
    const user = userEvent.setup();
    expect(prompt()).not.toBeNull();

    await user.click(input());
    await user.paste(A);
    expect(prompt()).toBeNull();

    await act(async () => slow.release());
    await heading(3, 3);
    expect(prompt()).toBeNull();
  });

  it("shows no prompt while a bare domain waits for discovery, and none once it loads", async () => {
    const slow = deferred();
    const hold = (url) => (url.host === A && url.pathname === "/collections.json" ? slow.promise : undefined);
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, hold));
    openAt("/");
    const user = userEvent.setup();

    await user.click(input());
    await user.paste(A);
    await waitFor(() => expect(dropdown().textContent).toMatch(/Discovering/));
    expect(prompt()).toBeNull();

    await act(async () => slow.release(jsonResponse({ collections: [{ handle: "all", title: "All", products_count: 3 }] })));
    await heading(3, 3);
    expect(prompt()).toBeNull();
  });

  it("returns the dropdown to its placeholder and drops the failed handle when a collection isn't found", async () => {
    const logged = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    for (const spy of logged) spy.mockImplementation(() => {});
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }));
    openAt(`/${A}/collections/nope`);

    expect(await screen.findByText(/That collection wasn't found/)).not.toBeNull();
    await waitFor(() => expect(dropdown().hasAttribute("data-placeholder")).toBe(true));
    expect(dropdown().textContent).toBe("Select a collection");

    const user = userEvent.setup();
    await user.click(dropdown());
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent.replace(/\s*\(\d+\)$/, "")).sort()).toEqual(["all", "mugs", "tees"]);
    expect(screen.queryByRole("option", { name: /nope/i })).toBeNull();

    const warnings = logged.flatMap((spy) => spy.mock.calls).filter((call) => /controlled/i.test(call.join(" ")));
    expect(warnings).toEqual([]);
  });

  it("keeps a failed handle that the store's own listing offers, but not selected", async () => {
    const refuse = (url) =>
      url.host === A && url.pathname === "/collections/tees/products.json" ? jsonResponse({}, { ok: false, status: 403 }) : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, refuse));
    openAt(`/${A}/collections/tees`);

    await screen.findByText(/password protected or blocking access/);
    await waitFor(() => expect(dropdown().hasAttribute("data-placeholder")).toBe(true));
    const user = userEvent.setup();
    await user.click(dropdown());
    const names = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(names.some((n) => /^tees/i.test(n))).toBe(true);
  });

  it("clears the selection when a collection chosen from the dropdown fails", async () => {
    const refuse = (url) =>
      url.host === A && url.pathname === "/collections/mugs/products.json" ? jsonResponse({}, { ok: false, status: 403 }) : undefined;
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: storeA() }, refuse));
    openAt(`/${A}/collections/tees`);
    await heading(3, 3);
    const user = userEvent.setup();
    await user.click(dropdown());
    await user.click(await screen.findByRole("option", { name: /^mugs/i }));

    await screen.findByText(/password protected or blocking access/);
    await waitFor(() => expect(dropdown().hasAttribute("data-placeholder")).toBe(true));
  });
});

// The sidebar controls, the sort, and Recent Stores, driven through the whole page.
describe("sidebar controls, sort and Recent Stores", () => {
  // Loading a collection starts with "In stock only" on, so the sold-out Delta Scarf
  // is the one product not shown at first: 3 of 4.
  const shop = () => ({
    collections: {
      all: [
        product({
          title: "Alpha Tee",
          handle: "alpha-tee",
          vendor: "Acme",
          product_type: "Shirts",
          tags: ["summer"],
          options: [{ name: "Size" }],
          variants: [variant({ price: "30.00", compare_at_price: "40.00", option1: "S" }), variant({ price: "35.00", option1: "M" })],
        }),
        product({ title: "Bravo Mug", handle: "bravo-mug", vendor: "Beta Co", product_type: "Mugs", tags: ["kitchen"], variants: [variant({ price: "10.00" })] }),
        product({ title: "Charlie Cap", handle: "charlie-cap", vendor: "Acme", product_type: "Hats", variants: [variant({ price: "20.00" })] }),
        product({ title: "Delta Scarf", handle: "delta-scarf", vendor: "Acme", product_type: "Scarves", variants: [variant({ price: "15.00", available: false })] }),
      ],
    },
  });
  const open = async (shown = 3) => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: shop() }));
    openAt(`/${A}/collections/all`);
    await heading(shown, 4);
    return userEvent.setup();
  };
  // The cards, in the order the grid shows them.
  const cardTitles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
  const checkbox = (name) => screen.getByRole("checkbox", { name });
  const sortSelect = () => screen.getAllByRole("combobox").at(-1);

  it("narrows the grid with a vendor checkbox and widens it again when cleared", async () => {
    const user = await open();
    await user.click(checkbox("Beta Co"));
    await heading(1, 4);
    expect(cardTitles()).toEqual(["Bravo Mug"]);
    await user.click(checkbox("Beta Co"));
    await heading(3, 4);
    expect(cardTitles()).toEqual(["Alpha Tee", "Bravo Mug", "Charlie Cap"]);
  });

  it("filters by category, tag and option value too", async () => {
    const user = await open();
    await user.click(checkbox("Hats"));
    await heading(1, 4);
    expect(cardTitles()).toEqual(["Charlie Cap"]);
    await user.click(checkbox("Hats"));
    await heading(3, 4);
    await user.click(checkbox("kitchen"));
    await heading(1, 4);
    expect(cardTitles()).toEqual(["Bravo Mug"]);
    await user.click(checkbox("kitchen"));
    await heading(3, 4);
    await user.click(checkbox("M"));
    await heading(1, 4);
    expect(cardTitles()).toEqual(["Alpha Tee"]);
  });

  it("'In stock only' starts on, hiding the sold-out product, and unticking brings it back", async () => {
    const user = await open();
    expect(checkbox("In stock only").getAttribute("aria-checked")).toBe("true");
    expect(titleShown("Delta Scarf")).toBeNull();
    await user.click(checkbox("In stock only"));
    await heading(4, 4);
    expect(titleShown("Delta Scarf")).not.toBeNull();
    await user.click(checkbox("In stock only"));
    await heading(3, 4);
    expect(titleShown("Delta Scarf")).toBeNull();
  });

  it("'On sale only' keeps just the discounted product", async () => {
    const user = await open();
    await user.click(checkbox("On sale only"));
    await heading(1, 4);
    expect(cardTitles()).toEqual(["Alpha Tee"]);
  });

  it("searches titles as you type, and clears from the clear button", async () => {
    const user = await open();
    await user.type(screen.getByPlaceholderText("Search products..."), "mug");
    await heading(1, 4);
    expect(cardTitles()).toEqual(["Bravo Mug"]);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await heading(3, 4);
  });

  it("narrows by price from the slider's keyboard", async () => {
    const user = await open();
    const [low] = screen.getAllByRole("slider");
    low.focus();
    await user.keyboard("{ArrowRight}");
    await heading(2, 4);
    expect(titleShown("Bravo Mug")).toBeNull();
  });

  it("sorts the grid from the sort dropdown", async () => {
    const user = await open();
    expect(cardTitles()).toEqual(["Alpha Tee", "Bravo Mug", "Charlie Cap"]);
    for (const [label, expected] of [
      ["Price: Low to High", ["Bravo Mug", "Charlie Cap", "Alpha Tee"]],
      ["Price: High to Low", ["Alpha Tee", "Charlie Cap", "Bravo Mug"]],
      ["Title Z-A", ["Charlie Cap", "Bravo Mug", "Alpha Tee"]],
    ]) {
      await user.click(sortSelect());
      await user.click(await screen.findByRole("option", { name: label }));
      await waitFor(() => expect(cardTitles()).toEqual(expected));
    }
  });

  it("opens a store from Recent Stores", async () => {
    vi.stubGlobal("fetch", fakeShopifyFetch({ [A]: shop(), [B]: storeB() }));
    openAt(`/${A}/collections/all`);
    await heading(3, 4);
    const user = userEvent.setup();
    await user.click(input());
    await user.clear(input());
    await user.paste(B);
    await heading(2, 2);

    await user.click(screen.getByTitle("Recent Stores"));
    await user.click(await screen.findByRole("menuitem", { name: A }));

    await heading(3, 4);
    expect(titleShown("Alpha Tee")).not.toBeNull();
    expect(window.location.pathname).toBe(`/${A}/collections/all`);
  });

  describe("sections the platform has no data for", () => {
    // These products do carry vendors, types, tags and options, so the sections
    // are absent only because the adapter says it can't supply them.
    const without = (capability) => {
      slowResolve.override = () => ({ ...shopifyAdapter, capabilities: { ...shopifyAdapter.capabilities, [capability]: false } });
    };

    it("shows them all for the real Shopify adapter", async () => {
      await open();
      for (const name of ["Acme", "Shirts", "summer", "S", "In stock only"]) expect(checkbox(name)).toBeTruthy();
    });

    it.each([
      ["vendors", "Acme"],
      ["categories", "Shirts"],
      ["tags", "summer"],
      ["variantOptions", "S"],
      ["variantStock", "In stock only"],
    ])("hides what depends on %s", async (capability, name) => {
      without(capability);
      // A platform that doesn't report stock has no in-stock filter, so the sold-out scarf shows too.
      await open(capability === "variantStock" ? 4 : 3);
      expect(screen.queryByRole("checkbox", { name })).toBeNull();
      // Everything else is still offered.
      for (const other of ["Acme", "Shirts", "summer", "S", "In stock only"].filter((n) => n !== name)) {
        expect(checkbox(other)).toBeTruthy();
      }
    });
  });
});
