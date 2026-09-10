import { defineConfig, devices } from "@playwright/test";
import base from "../playwright.config";

export default defineConfig(base, {
  testDir: ".",
  testMatch: "toggle-surfaces-local.spec.ts",
  outputDir: "../test-results/toggle-surfaces-browsers",
  reporter: "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
