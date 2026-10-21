// Explicit local QA only. This script never starts Docker, deploys or calls a real provider.
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import { readdirSync } from "node:fs";

const mode = process.argv[2] ?? "unit";
if (!["unit", "database", "browser"].includes(mode)) throw new Error("Use unit, database or browser");
const env = { ...process.env };
let executable = "node_modules/vitest/vitest.mjs";
let args;
if (mode === "unit") {
  delete env.LINE_PLATFORM_TEST_DATABASE_URL;
  delete env.LINE_MINIAPP_DB_QA;
  delete env.PUBLIC_ORDER_DB_REPLAY;
  args = ["run", "src/server/line-platform", "src/server/line-miniapp", "src/server/payment-providers",
    "src/server/notifications", "src/server/public-order", "src/server/auth/oauth", "src/app/api/auth",
    "src/app/api/mini", "src/app/api/payments", "src/app/api/line-platform", "src/app/api/webhooks/line-platform",
    "src/app/api/merchant/payment-integrations/operations", "src/app/api/admin/line-platform", "src/app/api/merchant/stalls",
    "src/app/api/public/orders", "src/app/api/public/order-session", "src/app/api/public/cart-handoff", "src/app/api/cron/notification-jobs", "src/app/api/cron/line-pay-recovery", "src/app/mini",
    "src/app/order/[trackingToken]/platform-fallback.test.tsx", "src/lib/qr-order-storage.test.ts", "src/lib/line-miniapp-entry.test.ts",
    "src/lib/line-miniapp-liff.test.ts", "src/lib/line-miniapp-links.test.ts", "src/lib/public-order-guest-proof.test.ts",
    "src/lib/order-item-status.test.ts", "src/lib/performance-url-redaction.test.ts", "src/components/qr-order-cart-persistence.test.ts",
    "src/lib/qr-cart.test.ts", "src/lib/qr-order-recovery.test.ts", "src/lib/takeout-customer-memory.test.ts",
    "src/lib/guest-cart-handoff.test.ts", "src/components/line-platform-cart-handoff.test.tsx",
    "src/components/line-platform-member-form.test.tsx", "src/app/store/[identifier]",
    "src/lib/oauth-linking.test.ts", "src/lib/auth-principal.test.ts", "src/lib/password-auth.test.ts",
    "src/lib/checkout.test.ts", "src/lib/staff-checkout.test.ts", "src/lib/public-order-client.test.ts",
    "src/components/qr-order-checkout-flow-controller.test.ts", "src/components/qr-order-checkout-controller.test.ts",
    "src/components/staff-order-board-checkout.test.ts", "src/components/public-order-tracker.test.tsx", "src/components/public-order-tracker.abort.test.tsx",
    "src/server/printing", "src/app/api/print-jobs", "src/offline", "src/server/offline"];
} else {
  loadEnvFile(".env.local");
  const db = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid");
  if (!["localhost", "127.0.0.1"].includes(db.hostname) || db.port !== "55722"
    || db.pathname !== "/stallorder_line_miniapp_20260926") throw new Error("LINE_QA_DATABASE_REJECTED");
  env.DATABASE_URL = process.env.DATABASE_URL;
  env.LINE_PLATFORM_TEST_DATABASE_URL = process.env.DATABASE_URL;
  env.LINE_MINIAPP_DB_QA = "true";
  if (mode === "database") {
    const files = ["src/server/line-platform", "src/server/line-miniapp", "src/server/payment-providers"]
      .flatMap(dir => readdirSync(dir).filter(name => name.endsWith(".integration.test.ts")).map(name => `${dir}/${name}`));
    args = ["run", "--maxWorkers=1", ...files];
  } else {
    executable = "node_modules/@playwright/test/cli.js";
    env.LINE_PLATFORM_UI_TEST = "true";
    env.PLAYWRIGHT_APP_URL = "https://127.0.0.1:3024";
    env.PLAYWRIGHT_REUSE_EXISTING_SERVER = "true";
    args = ["test", "e2e/line-platform-v2.spec.ts", "--reporter=line"];
  }
}
if (mode !== "browser") args.push("--exclude=artifacts/**", "--reporter=dot", "--reporter=json", `--outputFile=artifacts/line-v2-${mode}-results.json`);
const result = spawnSync(process.execPath, [executable, ...args], { env, stdio: "inherit", windowsHide: true });
if (result.error) throw new Error("LINE_QA_PROCESS_FAILED");
process.exitCode = result.status ?? 1;
