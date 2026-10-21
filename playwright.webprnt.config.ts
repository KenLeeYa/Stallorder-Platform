import { defineConfig } from "@playwright/test";

// Isolated component/native-SDK regression. No application login, DB, or printer.
export default defineConfig({
  testDir: "./e2e", testMatch: "webprnt-recovery.component.spec.ts",
  workers: 1, retries: 0, timeout: 30_000,
  reporter: "list",
  use: { userAgent: "webPRNTSupportMessageHandler iPad", viewport: { width: 1024, height: 768 }, serviceWorkers: "block" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
});
