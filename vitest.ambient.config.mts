import { defineConfig } from "vitest/config";

// Ambient runs hit production over the public internet: generous timeouts, one
// file at a time, and a JSON report as the machine-readable result the workflow
// consumes.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["ambient/**/*.ambient.test.ts"],
    testTimeout: 90000,
    hookTimeout: 180000,
    retry: 1,
    fileParallelism: false,
    reporters: ["default", "json"],
    outputFile: { json: "ambient-results.json" },
  },
});
