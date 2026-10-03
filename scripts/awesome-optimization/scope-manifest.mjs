import { createHash } from "node:crypto";

/** Executable recipes are checked-in authority; receipt fields never choose required work. */
export function scopeManifest(scope) {
  if (!["batch-1", "full"].includes(scope)) throw new Error("INVALID_SCOPE");
  const node = process.execPath;
  return [
    { id: "external-disabled", command: [node, "scripts/awesome-optimization/cli.mjs", "external-check"], timeoutMs: 10000 },
    { id: "client-boundaries", command: [node, "scripts/awesome-optimization/boundaries.mjs"], timeoutMs: 30000 },
    { id: "foundation-tests", command: [node, "node_modules/vitest/vitest.mjs", "run", "scripts/awesome-optimization", "scripts/responsive-qa-target.test.mjs", "scripts/lib/production-workflow-contract.test.mjs"], timeoutMs: 120000 },
    { id: "affected-authority-tests", command: [node, "node_modules/vitest/vitest.mjs", "run", "src/lib/use-live-resource.test.ts", "src/lib/report-data.test.ts", "src/server/merchant-applications/application-state.test.ts"], timeoutMs: 120000 },
    { id: "typecheck", command: [node, "node_modules/typescript/bin/tsc", "--noEmit"], timeoutMs: 180000 },
    { id: "affected-lint", command: [node, "node_modules/eslint/bin/eslint.js", "scripts/awesome-optimization", "e2e/responsive-lab/responsive-admin-workflows.spec.ts", "e2e/responsive-lab/responsive-merchant-workflows.spec.ts"], timeoutMs: 120000 },
    ...(scope === "full" ? ["core-cross-device-e2e", "database-tenant-regression", "native-compatibility", "paired-fixture-metrics"].map((id) => ({ id, command: null, timeoutMs: 1000 })) : []),
  ].map((check) => ({ ...check, required: true }));
}

export const manifestHash = (scope) => createHash("sha256").update(JSON.stringify({ scope, checks: scopeManifest(scope) })).digest("hex");
