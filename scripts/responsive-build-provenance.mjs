import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sourceInputs } from "./awesome-optimization/source-identity.mjs";
import { assertResponsiveQaTarget } from "./responsive-qa-target.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const productInputs = ["src", "prisma", "public", "next.config.ts", "package.json", "package-lock.json", "tsconfig.json", "postcss.config.mjs"];

export function captureResponsiveSource() {
  const patch = execFileSync("git", ["diff", "--binary", "HEAD"], { maxBuffer: 64 * 1024 * 1024 });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { maxBuffer: 64 * 1024 * 1024 });
  const digest = createHash("sha256").update(patch);
  for (const path of untracked.toString("utf8").split("\0").filter(Boolean)) {
    digest.update(path).update(readFileSync(path));
  }
  return {
    head: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    productSourceClean: git("status", "--porcelain", "--", ...productInputs) === "",
    worktreeDirty: git("status", "--porcelain") !== "",
    workingTreePatchSha256: digest.digest("hex"),
  };
}

function byteInputs(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? byteInputs(path) : [{ path: path.replaceAll("\\", "/"), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }];
  });
}

export function captureFrozenResponsiveSource() {
  const identity = sourceInputs(process.cwd());
  const additional = ["public", ...["react-query", "query-core", "react-table", "table-core"].map((name) => `node_modules/@tanstack/${name}`)].flatMap(byteInputs);
  const inputs = [...identity.inputs, ...additional, { path: "node_modules/next/package.json", sha256: createHash("sha256").update(readFileSync("node_modules/next/package.json")).digest("hex") }].sort((a,b) => a.path.localeCompare(b.path));
  return { head: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), productSourceClean: git("status", "--porcelain", "--", ...productInputs) === "", sourceIdentity: {
    sourceSha256: createHash("sha256").update(inputs.map(({path,sha256})=>`${path}\0${sha256 ?? "MISSING"}`).join("\n")).digest("hex"), inputs,
  } };
}

export function captureResponsiveArtifact() {
  const paths = [".next/server", ".next/static"].flatMap(byteInputs);
  for (const path of [".next/BUILD_ID", ".next/build-manifest.json", ".next/routes-manifest.json", ".next/prerender-manifest.json"]) {
    paths.push({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
  }
  return createHash("sha256").update(paths.sort((a,b)=>a.path.localeCompare(b.path)).map(({path,sha256})=>`${path}\0${sha256}`).join("\n")).digest("hex");
}

export function responsiveFrozenTarget(environment) {
  assertResponsiveQaTarget(environment);
  return { app: "http://127.0.0.1:3026", database: "127.0.0.1:56822/postgres", primaryApi: "http://127.0.0.1:56821" };
}

export function validateResponsiveBuildProvenance(manifest, current, options = {}) {
  if (!manifest || typeof manifest !== "object") throw new Error("RESPONSIVE_BUILD_PROVENANCE_MISSING");
  if (!/^[0-9a-f]{40}$/.test(manifest.head) || !/^[0-9a-f]{40}$/.test(manifest.tree)
    || typeof manifest.buildId !== "string" || !manifest.buildId) {
    throw new Error("RESPONSIVE_BUILD_PROVENANCE_INVALID");
  }
  if (options.expectedSourceSha256 !== undefined) {
    const expected = options.expectedSourceSha256;
    const target = { app: "http://127.0.0.1:3026", database: "127.0.0.1:56822/postgres", primaryApi: "http://127.0.0.1:56821" };
    if (!/^[a-f0-9]{64}$/.test(expected) || manifest.mode !== "frozen-source-v1"
      || manifest.sourceBefore?.sourceSha256 !== expected || manifest.sourceAfter?.sourceSha256 !== expected
      || current.sourceIdentity?.sourceSha256 !== expected || !Array.isArray(manifest.sourceBefore?.inputs) || !manifest.sourceBefore.inputs.length
      || JSON.stringify(manifest.sourceBefore.inputs) !== JSON.stringify(manifest.sourceAfter?.inputs)
      || JSON.stringify(current.target) !== JSON.stringify(target) || JSON.stringify(manifest.target) !== JSON.stringify(target)
      || !/^[a-f0-9]{64}$/.test(manifest.artifactSha256 ?? "") || manifest.artifactSha256 !== current.artifactSha256) {
      throw new Error("RESPONSIVE_FROZEN_BUILD_MISMATCH");
    }
  } else if (!manifest.productSourceClean || !current.productSourceClean) {
    throw new Error("RESPONSIVE_BUILD_PRODUCT_SOURCE_DIRTY");
  }
  if (manifest.head !== current.head || manifest.tree !== current.tree || manifest.buildId !== current.buildId) {
    throw new Error("RESPONSIVE_BUILD_PROVENANCE_MISMATCH");
  }
  return { ...manifest, runtimeWorktreeDirty: current.worktreeDirty, runtimeWorkingTreePatchSha256: current.workingTreePatchSha256 };
}

export function readResponsiveBuildProvenance(options = {}) {
  let manifest;
  let buildId;
  try {
    manifest = JSON.parse(readFileSync(".next/responsive-build-provenance.json", "utf8"));
    buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  } catch {
    throw new Error("RESPONSIVE_BUILD_PROVENANCE_MISSING");
  }
  const current = options.expectedSourceSha256 !== undefined
    ? { ...captureFrozenResponsiveSource(), buildId, artifactSha256: captureResponsiveArtifact(), target: responsiveFrozenTarget(process.env) }
    : { ...captureResponsiveSource(), buildId };
  return validateResponsiveBuildProvenance(manifest, current, options);
}
