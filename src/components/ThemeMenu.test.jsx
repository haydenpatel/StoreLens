// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeMenu from "./ThemeMenu";
import { THEME_KEY } from "@/lib/theme";

// Radix's DropdownMenu needs these to open in jsdom.
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

// A matchMedia whose dark query can be flipped, firing "change" like the OS does.
function stubSystem(initialDark) {
  const listeners = new Set();
  const query = {
    matches: initialDark,
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    listeners,
    setDark(dark) {
      query.matches = dark;
      act(() => listeners.forEach((fn) => fn({ matches: dark })));
    },
  };
}

const isDark = () => document.documentElement.classList.contains("dark");

async function choose(name) {
  await userEvent.click(screen.getByRole("button", { name: "Theme" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name }));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeMenu", () => {
  it("offers System, Light and Dark, with the saved choice checked", async () => {
    stubSystem(false);
    window.localStorage.setItem(THEME_KEY, "dark");
    render(<ThemeMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(screen.getByRole("menuitemradio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "System" }).getAttribute("aria-checked")).toBe("false");
    expect(isDark()).toBe(true);
  });

  it("applies and saves Dark, then Light, and removes the key for System", async () => {
    stubSystem(false);
    render(<ThemeMenu />);
    expect(isDark()).toBe(false);

    await choose("Dark");
    expect(isDark()).toBe(true);
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");

    await choose("Light");
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");

    await choose("System");
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("follows the OS while System, and ignores it under an explicit choice", async () => {
    const system = stubSystem(true);
    render(<ThemeMenu />);
    expect(isDark()).toBe(true);
    system.setDark(false);
    expect(isDark()).toBe(false);

    await choose("Dark");
    expect(system.listeners.size).toBe(0);
    system.setDark(false);
    expect(isDark()).toBe(true);

    await choose("Light");
    system.setDark(true);
    expect(isDark()).toBe(false);

    // Back to System picks up the OS value from while it wasn't watched.
    await choose("System");
    expect(isDark()).toBe(true);
    expect(system.listeners.size).toBe(1);
  });

  it("stops listening when it unmounts", () => {
    const system = stubSystem(false);
    render(<ThemeMenu />);
    expect(system.listeners.size).toBe(1);
    cleanup();
    expect(system.listeners.size).toBe(0);
  });

  it("works with no matchMedia (reads as light) and with storage that throws", async () => {
    vi.stubGlobal("matchMedia", undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ThemeMenu />);
    expect(isDark()).toBe(false);
    await choose("Dark");
    expect(isDark()).toBe(true);
    vi.restoreAllMocks();
  });
});
