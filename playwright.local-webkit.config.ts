import { defineConfig, devices } from "@playwright/test";
import config from "./playwright.local-qa.config";

export default defineConfig(config, {
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], browserName: "webkit", serviceWorkers: "block" } }],
});
