import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const searchRoots = [resolve(root, "src/v2"), resolve(root, "src")];
const candidateSuffixes = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// Staged files carry the same import paths they will have after activation, so
// `@/x` resolves inside src/v2 first and falls back to the shared modules that
// still live in src.
const stagedAlias = {
  name: "staged-alias",
  enforce: "pre" as const,
  resolveId(id: string) {
    if (!id.startsWith("@/")) return null;
    const relative = id.slice(2);
    for (const base of searchRoots) {
      for (const suffix of candidateSuffixes) {
        const candidate = resolve(base, relative + suffix);
        if (isFile(candidate)) return candidate;
      }
    }
    return null;
  },
};

export default defineConfig({
  plugins: [stagedAlias, react()],
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/v2/**/*.test.{ts,tsx}"],
    // Integration specs need a database matching the staged schema, which only
    // exists once the schema activates.
    exclude: [...configDefaults.exclude, "src/v2/**/*.integration.test.ts"],
  },
});
