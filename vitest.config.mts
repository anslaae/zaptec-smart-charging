import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // e2e/ holds Playwright UI tests (npm run test:ui), not unit tests.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
