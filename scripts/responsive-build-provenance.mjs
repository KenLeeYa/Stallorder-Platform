import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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

export function validateResponsiveBuildProvenance(manifest, current) {
  if (!manifest || typeof manifest !== "object") throw new Error("RESPONSIVE_BUILD_PROVENANCE_MISSING");
  if (!/^[0-9a-f]{40}$/.test(manifest.head) || !/^[0-9a-f]{40}$/.test(manifest.tree)
    || typeof manifest.buildId !== "string" || !manifest.buildId) {
    throw new Error("RESPONSIVE_BUILD_PROVENANCE_INVALID");
  }
  if (!manifest.productSourceClean || !current.productSourceClean) {
    throw new Error("RESPONSIVE_BUILD_PRODUCT_SOURCE_DIRTY");
  }
  if (manifest.head !== current.head || manifest.tree !== current.tree || manifest.buildId !== current.buildId) {
    throw new Error("RESPONSIVE_BUILD_PROVENANCE_MISMATCH");
  }
  return { ...manifest, runtimeWorktreeDirty: current.worktreeDirty, runtimeWorkingTreePatchSha256: current.workingTreePatchSha256 };
}

export function readResponsiveBuildProvenance() {
  let manifest;
  let buildId;
  try {
    manifest = JSON.parse(readFileSync(".next/responsive-build-provenance.json", "utf8"));
    buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  } catch {
    throw new Error("RESPONSIVE_BUILD_PROVENANCE_MISSING");
  }
  return validateResponsiveBuildProvenance(manifest, { ...captureResponsiveSource(), buildId });
}
