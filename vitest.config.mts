import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", pool: "threads", hookTimeout: 90000, testTimeout: 60000 },
  resolve: { tsconfigPaths: true },
});
