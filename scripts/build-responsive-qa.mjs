import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { assertResponsiveQaTarget } from "./responsive-qa-target.mjs";
import { captureResponsiveSource } from "./responsive-build-provenance.mjs";

loadEnvFile(".env.local");
assertResponsiveQaTarget(process.env);
const before = captureResponsiveSource();
if (!before.productSourceClean) throw new Error("RESPONSIVE_BUILD_PRODUCT_SOURCE_DIRTY");
const result = spawnSync("npm", ["run", "build"], { shell: process.platform === "win32", stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const after = captureResponsiveSource();
if (before.head !== after.head || before.tree !== after.tree || !after.productSourceClean) {
  throw new Error("RESPONSIVE_BUILD_SOURCE_CHANGED");
}
const manifest = {
  ...after,
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  builtAt: new Date().toISOString(),
};
writeFileSync(".next/responsive-build-provenance.json", `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ event: "responsive_qa_build_provenance_written", head: manifest.head, tree: manifest.tree, buildId: manifest.buildId, worktreeDirty: manifest.worktreeDirty }));
