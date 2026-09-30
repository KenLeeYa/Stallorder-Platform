import "./e2e/helpers/responsive-env";
import { defineConfig } from "@playwright/test";
import baseline from "./playwright.config";

export default defineConfig({
  ...baseline,
  workers: 1,
  retries: 0,
  testMatch: [
    "**/responsive-*.spec.ts",
    "**/staff-orders-print-runtime-responsive.spec.ts",
    "**/kds-production-board.spec.ts",
    "**/customer-order-functional-qa-local.spec.ts",
    "**/catalog-operations-local.spec.ts",
    "**/staff-kds-print-closure-flow.spec.ts",
    "**/multi-stall.spec.ts",
    "**/merchant-stall-settings-navigation.spec.ts",
    "**/operations-report-filter-responsive.spec.ts",
  ],
});
