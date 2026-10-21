import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import privacy from "./security-privacy.config";
export default defineConfig({ ...privacy, testMatch: "qr-manual-pickup-cash-checkout.spec.ts",
  reporter: [["list"], ["json", { outputFile: resolve("docs/security-compliance/business-browser-tests.json") }]] });
