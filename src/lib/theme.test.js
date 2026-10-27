import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  DARK_QUERY,
  THEME_KEY,
  applyTheme,
  readPreference,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  writePreference,
} from "./theme";

const __dirname = dirname(fileURLToPath(import.meta.url));

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const throwingStorage = () => {
  const boom = () => {
    throw new Error("blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom };
};

describe("readPreference", () => {
  it("reads light and dark, and treats everything else as system", () => {
    expect(readPreference(memoryStorage({ [THEME_KEY]: "light" }))).toBe("light");
    expect(readPreference(memoryStorage({ [THEME_KEY]: "dark" }))).toBe("dark");
    expect(readPreference(memoryStorage())).toBe("system");
    expect(readPreference(memoryStorage({ [THEME_KEY]: "system" }))).toBe("system");
    expect(readPreference(memoryStorage({ [THEME_KEY]: "purple" }))).toBe("system");
    expect(readPreference(memoryStorage({ [THEME_KEY]: "" }))).toBe("system");
  });

  it("falls back to system when storage is missing or throws", () => {
    expect(readPreference(null)).toBe("system");
    expect(readPreference(throwingStorage())).toBe("system");
  });
});

describe("writePreference", () => {
  it("stores light and dark, and removes the key for system", () => {
    const storage = memoryStorage();
    writePreference(storage, "dark");
    expect(storage.data[THEME_KEY]).toBe("dark");
    writePreference(storage, "light");
    expect(storage.data[THEME_KEY]).toBe("light");
    writePreference(storage, "system");
    expect(THEME_KEY in storage.data).toBe(false);
  });

  it("never stores a garbage value", () => {
    const storage = memoryStorage({ [THEME_KEY]: "dark" });
    writePreference(storage, "purple");
    expect(THEME_KEY in storage.data).toBe(false);
  });

  it("does not throw when storage is missing or throws", () => {
    expect(() => writePreference(throwingStorage(), "dark")).not.toThrow();
    expect(() => writePreference(null, "dark")).not.toThrow();
  });
});

describe("resolveTheme", () => {
  it("follows the system only for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("adds and removes the dark class", () => {
    const root = { classList: { toggle: vi.fn() } };
    applyTheme(root, "dark");
    expect(root.classList.toggle).toHaveBeenLastCalledWith("dark", true);
    applyTheme(root, "light");
    expect(root.classList.toggle).toHaveBeenLastCalledWith("dark", false);
  });
});

describe("systemPrefersDark", () => {
  it("reads the media query and tolerates a missing matchMedia", () => {
    expect(systemPrefersDark(() => ({ matches: true }))).toBe(true);
    expect(systemPrefersDark(() => ({ matches: false }))).toBe(false);
    expect(systemPrefersDark(undefined)).toBe(false);
  });
});

describe("watchSystemTheme", () => {
  function fakeMatchMedia() {
    const listeners = new Set();
    const query = {
      matches: false,
      addEventListener: vi.fn((type, fn) => listeners.add(fn)),
      removeEventListener: vi.fn((type, fn) => listeners.delete(fn)),
    };
    return { matchMedia: () => query, listeners, query };
  }

  it("reports changes and stops after unsubscribe", () => {
    const { matchMedia, listeners, query } = fakeMatchMedia();
    const onChange = vi.fn();
    const stop = watchSystemTheme(matchMedia, onChange);
    expect(query.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    listeners.forEach((fn) => fn({ matches: true }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    listeners.forEach((fn) => fn({ matches: false }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("is a no-op without matchMedia or without addEventListener", () => {
    expect(watchSystemTheme(undefined, vi.fn())()).toBeUndefined();
    expect(watchSystemTheme(() => ({}), vi.fn())()).toBeUndefined();
  });
});

// The inline script in index.html runs before the bundle loads, so it repeats
// the rules above. This runs the real script against stubs and checks it gives
// the same answer as resolveTheme for every combination.
describe("index.html pre-render script", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  function run({ storage, systemDark, matchMedia = true }) {
    const classes = new Set();
    const document = {
      documentElement: {
        classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
      },
    };
    const window = matchMedia
      ? { matchMedia: (q) => ({ matches: q === DARK_QUERY && systemDark }) }
      : {};
    const localStorage = storage;
    new Function("document", "window", "localStorage", scripts[0])(document, window, localStorage);
    return classes.has("dark") ? "dark" : "light";
  }

  it("has exactly one inline classic script, before the module script", () => {
    expect(scripts).toHaveLength(1);
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('type="module"'));
  });

  it.each([
    [undefined, true],
    [undefined, false],
    ["light", true],
    ["light", false],
    ["dark", true],
    ["dark", false],
    ["purple", true],
    ["purple", false],
  ])("stored %s with OS dark=%s matches resolveTheme", (stored, systemDark) => {
    const storage = memoryStorage(stored === undefined ? {} : { [THEME_KEY]: stored });
    expect(run({ storage, systemDark })).toBe(
      resolveTheme(readPreference(storage), systemDark),
    );
  });

  it("falls back to the system setting when storage throws", () => {
    expect(run({ storage: throwingStorage(), systemDark: true })).toBe("dark");
    expect(run({ storage: throwingStorage(), systemDark: false })).toBe("light");
  });

  it("falls back to light when matchMedia is missing", () => {
    expect(run({ storage: memoryStorage(), systemDark: true, matchMedia: false })).toBe("light");
    expect(run({ storage: memoryStorage({ [THEME_KEY]: "dark" }), systemDark: false, matchMedia: false })).toBe("dark");
  });
});
