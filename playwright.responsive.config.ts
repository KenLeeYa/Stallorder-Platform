import { defineConfig } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { assertResponsiveQaTarget } from "./scripts/responsive-qa-target.mjs";
import baseline from "./playwright.config";

loadEnvFile(".env.local");
assertResponsiveQaTarget(process.env);

export default defineConfig({
  ...baseline,
  workers: 1,
  retries: 0,
  testMatch: [
    "**/responsive-*.spec.ts",
    "**/staff-orders-print-runtime-responsive.spec.ts",
    "**/kds-production-board.spec.ts",
  ],
});
