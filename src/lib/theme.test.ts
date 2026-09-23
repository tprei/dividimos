import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./theme";

const { configureStatusBarMock } = vi.hoisted(() => ({
  configureStatusBarMock: vi.fn(),
}));

vi.mock("@/lib/capacitor/status-bar", () => ({
  configureStatusBar: configureStatusBarMock,
}));

const originalMatchMedia = window.matchMedia.bind(window);

function stubSystemScheme(prefersDark: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const media = originalMatchMedia(query);
    Object.defineProperty(media, "matches", { value: prefersDark, configurable: true });
    return media;
  });
}

function appendThemeColorMeta(): HTMLMetaElement {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", "stale");
  document.head.appendChild(meta);
  return meta;
}

beforeEach(() => {
  configureStatusBarMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe("resolveTheme", () => {
  it("follows the system scheme when the preference is system", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("lets an explicit preference win over the system scheme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readThemePreference", () => {
  it("returns system when nothing is stored", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("returns system for unknown stored values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("returns stored explicit preferences", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readThemePreference()).toBe("light");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readThemePreference()).toBe("dark");
  });
});

describe("setThemePreference", () => {
  it("stores dark, applies it, and syncs the status bar", async () => {
    stubSystemScheme(false);
    appendThemeColorMeta();

    const resolved = setThemePreference("dark");

    expect(resolved).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    await vi.waitFor(() => expect(configureStatusBarMock).toHaveBeenCalledWith("dark"));
  });

  it("stores light and applies it over a dark system", async () => {
    stubSystemScheme(true);
    appendThemeColorMeta();

    const resolved = setThemePreference("light");

    expect(resolved).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    await vi.waitFor(() => expect(configureStatusBarMock).toHaveBeenCalledWith("light"));
  });

  it("removes the stored key and follows the system when the preference is system", () => {
    stubSystemScheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    const resolved = setThemePreference("system");

    expect(resolved).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

describe("applyTheme", () => {
  it("rewrites every theme-color meta to the resolved palette", async () => {
    const first = appendThemeColorMeta();
    const second = appendThemeColorMeta();

    applyTheme("dark");

    expect(first.getAttribute("content")).toBe(THEME_COLORS.dark);
    expect(second.getAttribute("content")).toBe(THEME_COLORS.dark);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await vi.waitFor(() => expect(configureStatusBarMock).toHaveBeenCalledWith("dark"));
  });

  it("removes the dark class and restores light colors", async () => {
    document.documentElement.classList.add("dark");
    const meta = appendThemeColorMeta();

    applyTheme("light");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(meta.getAttribute("content")).toBe(THEME_COLORS.light);
    await vi.waitFor(() => expect(configureStatusBarMock).toHaveBeenCalledWith("light"));
  });
});
