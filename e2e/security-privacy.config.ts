import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({ testDir: ".", testMatch: "security-privacy.spec.ts", workers: 1, fullyParallel: false, retries: 0,
  timeout: 120000, expect: { timeout: 30000 }, reporter: [["list"], ["json", { outputFile: resolve("docs/security-compliance/browser-tests.json") }]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3093", locale: "zh-TW", timezoneId: "Asia/Taipei", screenshot: "only-on-failure", trace: "retain-on-failure" } });
