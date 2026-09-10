import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "checkbox-toggle.spec.ts",
  outputDir: "../test-results/toggle-controls",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
});
