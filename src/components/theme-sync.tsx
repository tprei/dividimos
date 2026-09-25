"use client";

import { useEffect } from "react";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  watchSystemTheme,
} from "@/lib/theme";

/**
 * Applies the persisted/system theme once on mount and, while the preference
 * is "system", keeps following OS scheme changes. The boot script in the
 * document head already painted the right theme; this adds the native status
 * bar sync and the live system watcher.
 */
export function ThemeSync() {
  useEffect(() => {
    applyTheme(
      resolveTheme(
        readThemePreference(),
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      ),
    );
    return watchSystemTheme((prefersDark) => {
      if (readThemePreference() === "system") {
        applyTheme(resolveTheme("system", prefersDark));
      }
    });
  }, []);

  return null;
}
