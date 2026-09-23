export type ThemePreference = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#F9F9FB",
  dark: "#09243f",
};

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const meta of metas) {
    meta.setAttribute("content", THEME_COLORS[resolved]);
  }
  import("@/lib/capacitor/status-bar")
    .then(({ configureStatusBar }) => configureStatusBar(resolved))
    .catch((error: unknown) => {
      console.error("[theme] status bar sync failed:", error);
    });
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    if (preference === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // The choice still holds for this session; only persistence is lost.
  }
  const resolved = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  applyTheme(resolved);
  return resolved;
}

export function watchSystemTheme(onChange: (prefersDark: boolean) => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (event: MediaQueryListEvent): void => onChange(event.matches);
  media.addEventListener("change", listener);
  return () => {
    media.removeEventListener("change", listener);
  };
}

export const THEME_BOOT_SCRIPT = `(function(){var s=null;try{s=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){s=null}var dark=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var el=document.documentElement;el.classList.toggle("dark",dark);el.style.colorScheme=dark?"dark":"light";var metas=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<metas.length;i++)metas[i].setAttribute("content",dark?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")})();`;
