// Theme preference: "system" (the default, follows the OS), "light" or "dark".
// Only light/dark are stored; System means the key is absent. The inline
// script in index.html applies the same rules before first paint, and
// theme.test.js pins the two together, so change both or neither.
export const THEME_KEY = "storelens-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";
// The page background in each theme, for the browser's theme-color (address
// bar and status bar tint). Keep in step with --background in index.css.
export const THEME_COLORS = { light: "#ffffff", dark: "#09090b" };
export const PREFERENCES = ["system", "light", "dark"];

// localStorage can throw on access (blocked storage), so the lookup is guarded
// like every read and write below.
export function getStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPreference(storage) {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function writePreference(storage, preference) {
  try {
    if (preference === "light" || preference === "dark") {
      storage.setItem(THEME_KEY, preference);
    } else {
      storage.removeItem(THEME_KEY);
    }
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
}

export function resolveTheme(preference, systemDark) {
  if (preference === "light" || preference === "dark") return preference;
  return systemDark ? "dark" : "light";
}

// The `dark:` variant matches descendants of `.dark`, so the class goes on <html>.
export function applyTheme(root, theme) {
  root.classList.toggle("dark", theme === "dark");
}

// Points every theme-color meta at the theme, so it follows the user's choice
// and not just the OS (the media attributes in index.html only know the OS).
export function applyThemeColor(doc, theme) {
  const color = THEME_COLORS[theme === "dark" ? "dark" : "light"];
  doc.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", color));
}

export function systemPrefersDark(matchMediaFn) {
  return typeof matchMediaFn === "function" && matchMediaFn(DARK_QUERY).matches === true;
}

// Calls onChange(systemDark) whenever the OS setting changes; returns the
// unsubscribe function.
export function watchSystemTheme(matchMediaFn, onChange) {
  if (typeof matchMediaFn !== "function") return () => {};
  const query = matchMediaFn(DARK_QUERY);
  if (typeof query?.addEventListener !== "function") return () => {};
  const handler = (event) => onChange(event.matches === true);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

// Calls onChange(preference) when another tab changes the saved choice
// (a "storage" event for THEME_KEY, or null when storage is cleared); returns
// the unsubscribe function.
export function watchStoredTheme(target, onChange) {
  const handler = (event) => {
    if (event.key === THEME_KEY || event.key === null) {
      onChange(readPreference(event.storageArea ?? getStorage()));
    }
  };
  target.addEventListener("storage", handler);
  return () => target.removeEventListener("storage", handler);
}
