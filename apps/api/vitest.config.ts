import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
