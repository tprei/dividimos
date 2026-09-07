import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["src/**/*.integration.test.ts"],
    // The staged specs need a database matching the staged schema, which only
    // exists once the schema activates.
    exclude: [...configDefaults.exclude, "src/v2/**"],
    setupFiles: ["./src/test/integration-setup.ts"],
    fileParallelism: false,
  },
});
