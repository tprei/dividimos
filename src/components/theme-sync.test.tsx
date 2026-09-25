import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { ThemeSync } from "./theme-sync";

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

describe("ThemeSync", () => {
  it("follows a theme chosen in another tab", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeSync />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY, newValue: "dark" }));
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});