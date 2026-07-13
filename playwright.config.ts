import { defineConfig, devices } from "@playwright/test";

const appUrl = "http://localhost:3001";
const oauthMockUrl = "http://127.0.0.1:55431";

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
  webServer: [
    {
      command: "node e2e/oauth-provider-mock.mjs",
      url: `${oauthMockUrl}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `cross-env NEXT_PUBLIC_APP_URL=${appUrl} NEXT_PUBLIC_SUPABASE_URL=${oauthMockUrl} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-publishable-key next dev -p 3001`,
      url: `${appUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
