import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@blockbench-codex/geometry": fileURLToPath(
        new URL("./packages/geometry/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
    },
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
