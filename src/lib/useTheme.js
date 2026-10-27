import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  getStorage,
  readPreference,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  writePreference,
} from "@/lib/theme";

// Without matchMedia (old test environments) the system counts as light.
const matchMediaFn = (query) => window.matchMedia(query);
const getMatchMedia = () => (typeof window.matchMedia === "function" ? matchMediaFn : undefined);

// Owns the theme state: the saved choice (System, Light or Dark), whether the
// OS is dark right now, and the resulting theme, which it puts on <html>.
// The OS is only watched while the choice is System.
export function useTheme() {
  const [preference, setPreferenceState] = useState(() => readPreference(getStorage()));
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark(getMatchMedia()));
  const theme = resolveTheme(preference, systemDark);

  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);

  useEffect(() => {
    if (preference !== "system") return undefined;
    return watchSystemTheme(getMatchMedia(), setSystemDark);
  }, [preference]);

  const setPreference = useCallback((next) => {
    writePreference(getStorage(), next);
    // The OS isn't watched under Light or Dark, so read it afresh for System.
    setSystemDark(systemPrefersDark(getMatchMedia()));
    // Kept in memory even when storage is blocked, so the menu still works.
    setPreferenceState(next === "light" || next === "dark" ? next : "system");
  }, []);

  return { preference, theme, setPreference };
}
