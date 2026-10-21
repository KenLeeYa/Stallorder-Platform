import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { assertResponsiveQaTarget } from "./responsive-qa-target.mjs";
import { createServer } from "node:net";
import { captureResponsiveSource, captureFrozenResponsiveSource, captureResponsiveArtifact, responsiveFrozenTarget } from "./responsive-build-provenance.mjs";

loadEnvFile(".env.local");
assertResponsiveQaTarget(process.env);
const frozen = process.argv.slice(2).length === 1 && process.argv[2] === "--frozen-source";
if (process.argv.length > 2 && !frozen) throw Error("RESPONSIVE_BUILD_ARGUMENT_INVALID");
// Caller stops its positively identified App before any build; never build over a listener.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () => reject(Error("RESPONSIVE_APP_RUNNING_STOP_MATCHING_FIRST")));
  probe.listen(3026, "127.0.0.1", () => probe.close(resolve));
});
const capture = frozen ? captureFrozenResponsiveSource : captureResponsiveSource;
const before = capture();
if (!frozen && !before.productSourceClean) throw new Error("RESPONSIVE_BUILD_PRODUCT_SOURCE_DIRTY");
const result = spawnSync("npm", ["run", "build"], { shell: process.platform === "win32", stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const after = capture();
if (before.head !== after.head || before.tree !== after.tree || (frozen ? before.sourceIdentity.sourceSha256 !== after.sourceIdentity.sourceSha256 : !after.productSourceClean)) {
  throw new Error("RESPONSIVE_BUILD_SOURCE_CHANGED");
}
const manifest = {
  ...after,
  buildId: readFileSync(".next/BUILD_ID", "utf8").trim(),
  builtAt: new Date().toISOString(),
  ...(frozen ? { mode: "frozen-source-v1", sourceBefore: before.sourceIdentity, sourceAfter: after.sourceIdentity,
    artifactSha256: captureResponsiveArtifact(), target: responsiveFrozenTarget(process.env) } : {}),
};
writeFileSync(".next/responsive-build-provenance.json", `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ event: "responsive_qa_build_provenance_written", head: manifest.head, tree: manifest.tree, buildId: manifest.buildId, worktreeDirty: manifest.worktreeDirty }));
