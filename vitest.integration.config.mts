import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test/integration-setup.ts"],
    // Run integration tests sequentially to avoid DB conflicts
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
