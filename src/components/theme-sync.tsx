"use client";

import { useEffect } from "react";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  watchSystemTheme,
} from "@/lib/theme";

/**
 * Applies the persisted/system theme on mount, follows OS scheme changes
 * while the preference is "system", and picks up a preference changed in
 * another tab. The boot script in the document head already painted the
 * right theme; this adds the native status bar sync and the live watchers.
 */
export function ThemeSync() {
  useEffect(() => {
    const applyStored = () =>
      applyTheme(
        resolveTheme(
          readThemePreference(),
          window.matchMedia("(prefers-color-scheme: dark)").matches,
        ),
      );
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) applyStored();
    };
    applyStored();
    window.addEventListener("storage", onStorage);
    const stopWatching = watchSystemTheme((prefersDark) => {
      if (readThemePreference() === "system") {
        applyTheme(resolveTheme("system", prefersDark));
      }
    });
    return () => {
      window.removeEventListener("storage", onStorage);
      stopWatching();
    };
  }, []);

  return null;
}
