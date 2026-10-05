// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreLensApp from "./StoreLens";
import { product, variant } from "../lib/__fixtures__/shopify";
import { fakeShopifyFetch } from "../lib/__fixtures__/fake-shopify-fetch";
import { jsonResponse } from "../lib/__fixtures__/test-helpers";

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

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoopObserver);
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("matchMedia", desktopMatchMedia);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
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
