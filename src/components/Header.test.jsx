// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Header from "./Header";

// Radix's Select and DropdownMenu need these to open in jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

function renderHeader(overrides = {}) {
  const props = {
    storeInput: "shop.example.com",
    onStoreInputChange: vi.fn(),
    onStorePaste: vi.fn(),
    onLoad: vi.fn(),
    loading: false,
    urlHistory: [],
    onSelectHistory: vi.fn(),
    collections: [],
    collectionsStatus: "idle",
    selectedHandle: "",
    onSelectHandle: vi.fn(),
    onRetryCollections: vi.fn(),
    ...overrides,
  };
  render(<Header {...props} />);
  return props;
}

const urlField = () => screen.getByPlaceholderText("Paste a store or collection URL");
const loadButton = () => screen.getByTitle("Load this store");
const collectionSelect = () => screen.getByRole("combobox");
const recentStores = () => screen.getByTitle("Recent Stores");

describe("Header store field", () => {
  it("reports typing and Enter, and loads from the button", async () => {
    const props = renderHeader({ storeInput: "" });
    await userEvent.type(urlField(), "a");
    expect(props.onStoreInputChange).toHaveBeenLastCalledWith("a");

    cleanup();
    const loaded = renderHeader();
    await userEvent.type(urlField(), "{Enter}");
    expect(loaded.onLoad).toHaveBeenCalledTimes(1);
    await userEvent.click(loadButton());
    expect(loaded.onLoad).toHaveBeenCalledTimes(2);
  });

  it("hands pasted text to onStorePaste instead of inserting it itself", () => {
    const props = renderHeader({ storeInput: "" });
    fireEvent.paste(urlField(), { clipboardData: { getData: () => "https://shop.example.com/collections/tees" } });
    expect(props.onStorePaste).toHaveBeenCalledWith("https://shop.example.com/collections/tees");
    expect(props.onStoreInputChange).not.toHaveBeenCalled();
  });

  it("disables the field and button while loading, and ignores Enter", () => {
    const props = renderHeader({ loading: true });
    expect(urlField().disabled).toBe(true);
    expect(loadButton().disabled).toBe(true);
    fireEvent.keyPress(urlField(), { key: "Enter", charCode: 13 });
    expect(props.onLoad).not.toHaveBeenCalled();
  });

  it("disables the load button for a blank field", () => {
    renderHeader({ storeInput: "   " });
    expect(loadButton().disabled).toBe(true);
  });

  it("links to the feedback page in a new tab", () => {
    renderHeader();
    const link = screen.getByRole("link", { name: "Feedback" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});

describe("Header collection dropdown", () => {
  it.each([
    [{ collectionsStatus: "loading" }, "Discovering collections..."],
    [{ collectionsStatus: "error" }, "Couldn't load collections"],
    [{ collectionsStatus: "ready", collections: [] }, "No collections found"],
    [{ collectionsStatus: "ready", collections: [{ handle: "tees", title: "Tees" }] }, "Select a collection"],
  ])("shows the right placeholder for %j", (props, placeholder) => {
    renderHeader(props);
    expect(collectionSelect().textContent).toBe(placeholder);
  });

  it("lists collections with their counts, and reports the one chosen", async () => {
    const collections = [
      { handle: "tees", title: "Tees", products_count: 12 },
      { handle: "mugs", title: "Mugs", products_count: null },
    ];
    const props = renderHeader({ collectionsStatus: "ready", collections });
    await userEvent.click(collectionSelect());
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Tees (12)", "Mugs"]);
    await userEvent.click(options[1]);
    expect(props.onSelectHandle).toHaveBeenCalledWith("mugs");
  });

  it("shows the selected collection", () => {
    renderHeader({ collectionsStatus: "ready", collections: [{ handle: "tees", title: "Tees", products_count: 3 }], selectedHandle: "tees" });
    expect(collectionSelect().textContent).toBe("Tees (3)");
  });

  it("adds a disabled partial-list warning and the platform's note after the collections", async () => {
    renderHeader({
      collectionsStatus: "ready",
      collectionsPartial: true,
      collectionsNote: "This platform can't list collections.",
      collections: [{ handle: "all", title: "All Products" }],
    });
    await userEvent.click(collectionSelect());
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "All Products",
      "The store didn't answer every request, so this list may be incomplete. Use the retry button.",
      "This platform can't list collections.",
    ]);
    expect(options.slice(1).every((o) => o.getAttribute("aria-disabled") === "true")).toBe(true);
  });

  it("shows the error text as a disabled entry", async () => {
    renderHeader({ collectionsStatus: "error", collectionsError: "No luck." });
    await userEvent.click(collectionSelect());
    const [option] = await screen.findAllByRole("option");
    expect(option.textContent).toBe("No luck.");
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });

  it("is disabled while loading or with no store entered", () => {
    renderHeader({ loading: true, collectionsStatus: "ready", collections: [{ handle: "a", title: "A" }] });
    expect(collectionSelect().disabled).toBe(true);
    cleanup();
    renderHeader({ storeInput: "", collectionsStatus: "idle" });
    expect(collectionSelect().disabled).toBe(true);
  });

  it("offers a retry after an error or a partial list, and not otherwise", async () => {
    const props = renderHeader({ collectionsStatus: "error" });
    await userEvent.click(screen.getByTitle("Retry loading collections"));
    expect(props.onRetryCollections).toHaveBeenCalledTimes(1);
    cleanup();
    renderHeader({ collectionsStatus: "ready", collectionsPartial: true, collections: [] });
    expect(screen.getByTitle("Retry loading collections")).toBeTruthy();
    cleanup();
    renderHeader({ collectionsStatus: "ready", collections: [] });
    expect(screen.queryByTitle("Retry loading collections")).toBeNull();
    cleanup();
    renderHeader({ collectionsStatus: "loading" });
    expect(screen.queryByTitle("Retry loading collections")).toBeNull();
  });
});

describe("Header Recent Stores", () => {
  it("is disabled with no history or while loading", () => {
    renderHeader({ urlHistory: [] });
    expect(recentStores().disabled).toBe(true);
    cleanup();
    renderHeader({ urlHistory: ["https://shop.example.com"], loading: true });
    expect(recentStores().disabled).toBe(true);
  });

  it("lists each store, keeping a locale in the label, and reports the one chosen", async () => {
    const history = ["https://shop.example.com", "https://shop.example.com/en-ca", "other.example.com"];
    const props = renderHeader({ urlHistory: history });
    await userEvent.click(recentStores());
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["shop.example.com", "shop.example.com/en-ca", "other.example.com"]);
    await userEvent.click(items[1]);
    expect(props.onSelectHistory).toHaveBeenCalledWith("https://shop.example.com/en-ca");
  });
});
