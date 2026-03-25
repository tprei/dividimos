import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright transform cache
    ".home/**",
  ]),
  // Project-level rule overrides — this codebase uses client-side data fetching
  // in effects (fetch → setState), which is a legitimate pattern that the strict
  // React 19 rule flags. Migrating to server components or a data-fetching library
  // would be the long-term fix. Until then, disable the rule at the config level
  // rather than sprinkling eslint-disable comments.
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
