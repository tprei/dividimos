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
    // Claude Code agent worktrees
    ".claude/worktrees/**",
    // Generated Capacitor native build output (gitignored); the only JS here
    // is the generated native-bridge.js bundle.
    "android/**",
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
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // @next/next/no-img-element is a production-bundle performance rule (LCP,
  // bandwidth). It has no meaning in vitest unit tests, which stub next/image
  // with a plain <img> on purpose. Scope it off there rather than mocking
  // around it.
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  // The receipt scanner previews a client-side object URL (URL.createObjectURL)
  // of a user-captured photo with unknown intrinsic dimensions. next/image
  // cannot size it to its natural aspect ratio without measuring, and a local
  // blob cannot be optimized, so a plain <img> is correct here.
  {
    files: ["src/components/bill/receipt-scanner.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
]);

export default eslintConfig;
