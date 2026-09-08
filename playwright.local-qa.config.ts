import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

const database = new URL(process.env.DATABASE_URL ?? "");
const app = new URL(process.env.PLAYWRIGHT_APP_URL ?? "");
if (
  !["127.0.0.1", "localhost"].includes(database.hostname)
  || database.port !== "55722"
  || !["127.0.0.1", "localhost"].includes(app.hostname)
  || app.port !== "3018"
  || process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER !== "true"
) throw new Error("DEDICATED_LOCAL_QA_RUNTIME_REQUIRED");

// PWA/offline cases use the original config and their own worker-specific setup.
export default defineConfig(config, {
  use: { ...config.use, serviceWorkers: "block", actionTimeout: 20_000 },
  webServer: undefined,
});
