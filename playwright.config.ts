import { defineConfig, devices } from "@playwright/test";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const appUrl = process.env.PLAYWRIGHT_APP_URL ?? "http://localhost:3001";
const oauthMockUrl = "http://127.0.0.1:55431";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";
const productionServer = process.env.PLAYWRIGHT_PRODUCTION_SERVER === "true";
const appServerCommand = productionServer ? "next start -p 3001" : "next dev -p 3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: appUrl,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: reuseExistingServer ? undefined : [
    {
      command: "node e2e/oauth-provider-mock.mjs",
      url: `${oauthMockUrl}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `cross-env NEXT_PUBLIC_APP_URL=${appUrl} PUBLIC_ORDER_FUNCTION_ORIGIN=${appUrl} NEXT_PUBLIC_SUPABASE_URL=${oauthMockUrl} NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA LOCAL_QA_DISABLE_LOGIN_RATE_LIMIT=true CRON_SECRET=e2e-cron-secret REPORT_DELIVERY_MODE=simulate VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=staging STAGING_PLATFORM_ADMIN_BOOTSTRAP_EMAILS=platform.admin.e2e@stallorder.test ${appServerCommand}`,
      url: `${appUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
