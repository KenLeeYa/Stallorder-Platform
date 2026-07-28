import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const buildDirectory = path.resolve(".next");
const routeBudgets = [
  { route: "kitchen/page", maxBytes: 130_000 },
  { route: "onboarding/page", maxBytes: 130_000 },
  { route: "q/[qrToken]/page", maxBytes: 180_000 },
  { route: "display/[stallSlug]/page", maxBytes: 140_000 },
  { route: "staff/[stallSlug]/page", maxBytes: 200_000 },
  { route: "merchant/dashboard/page", maxBytes: 150_000 },
  { route: "merchant/report-schedules/page", maxBytes: 140_000 },
  { route: "merchant/catalog/page", maxBytes: 210_000 },
];

const results = [];
for (const budget of routeBudgets) {
  const manifestPath = path.join(
    buildDirectory,
    "server",
    "app",
    ...budget.route.split("/"),
  ) + "_client-reference-manifest.js";
  const context = { globalThis: {} };
  vm.runInNewContext(await readFile(manifestPath, "utf8"), context, {
    filename: manifestPath,
  });

  const manifest = context.globalThis.__RSC_MANIFEST?.[`/${budget.route}`];
  const entryKey = `[project]/src/app/${budget.route}`;
  const chunks = manifest?.entryJSFiles?.[entryKey];
  if (!Array.isArray(chunks)) {
    throw new Error(`Missing client entry chunks for ${budget.route}`);
  }

  let totalBytes = 0;
  for (const chunk of new Set(chunks)) {
    totalBytes += (await stat(path.join(buildDirectory, chunk))).size;
  }
  results.push({
    route: `/${budget.route.replace(/\/page$/, "")}`,
    totalBytes,
    maxBytes: budget.maxBytes,
    passed: totalBytes <= budget.maxBytes,
  });
}

console.log(JSON.stringify({
  event: "client_bundle_budget_checked",
  unit: "uncompressed_entry_js_bytes",
  results,
}));

if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
}
