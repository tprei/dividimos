import { afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";

const localStorageValues = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    clear: () => localStorageValues.clear(),
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    key: (index: number) => Array.from(localStorageValues.keys())[index] ?? null,
    get length() {
      return localStorageValues.size;
    },
    removeItem: (key: string) => localStorageValues.delete(key),
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
  },
});

// Ensure cleanup between tests
afterEach(() => {
  localStorage.clear();
});

