import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "src/test/server-only.ts"),
    },
  },
  test: {
    // These control suites run explicitly with node --test in the required CI job.
    exclude: [...configDefaults.exclude, "e2e/**", "scripts/ci/delivery-*.test.mjs"],
    maxWorkers: 4,
  },
});
