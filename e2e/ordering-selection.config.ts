import { defineConfig, devices } from "@playwright/test";
import base from "../playwright.config";

export default defineConfig(base, {
  testDir: ".",
  testMatch: ["ordering-selection.spec.ts", "toggle-surfaces-local.spec.ts"],
  grep: /Ordering selections:|Staff item selection checkboxes|Staff modifier checkboxes/,
  outputDir: "../test-results/ordering-selection",
  reporter: "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
