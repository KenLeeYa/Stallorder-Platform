import { expect, test } from "vitest";
import { validateResponsiveBuildProvenance } from "./responsive-build-provenance.mjs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const manifest = {
  head: "a".repeat(40),
  tree: "b".repeat(40),
  buildId: "build-a",
  productSourceClean: true,
};
const current = { ...manifest };

test("accepts the build linked to the current revision and Next build ID", () => {
  expect(validateResponsiveBuildProvenance(manifest, current)).toMatchObject(manifest);
});

test("rejects missing, changed-revision and changed-build evidence", () => {
  expect(() => validateResponsiveBuildProvenance(null, current)).toThrow();
  expect(() => validateResponsiveBuildProvenance(manifest, { ...current, head: "c".repeat(40) })).toThrow();
  expect(() => validateResponsiveBuildProvenance(manifest, { ...current, tree: "d".repeat(40) })).toThrow();
  expect(() => validateResponsiveBuildProvenance(manifest, { ...current, buildId: "build-b" })).toThrow();
  expect(() => validateResponsiveBuildProvenance(manifest, { ...current, productSourceClean: false })).toThrow();
});

test("hashes the complete working diff when QA evidence exceeds the default child-process buffer", () => {
  const repository = mkdtempSync(join(tmpdir(), "responsive-source-diff-"));
  try {
    execFileSync("git", ["-C", repository, "init", "--quiet"]);
    execFileSync("git", ["-C", repository, "-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "baseline"]);
    writeFileSync(join(repository, "evidence.bin"), randomBytes(1_250_000));
    execFileSync("git", ["-C", repository, "add", "evidence.bin"]);
    const patch = execFileSync("git", ["-C", repository, "diff", "--binary", "HEAD"], { maxBuffer: 64 * 1024 * 1024 });
    expect(patch.byteLength).toBeGreaterThan(1024 * 1024);
    const moduleUrl = new URL("./responsive-build-provenance.mjs", import.meta.url).href;
    const actual = execFileSync(process.execPath, ["--input-type=module", "-e", `import { captureResponsiveSource } from ${JSON.stringify(moduleUrl)}; process.stdout.write(captureResponsiveSource().workingTreePatchSha256);`], { cwd: repository, encoding: "utf8" });
    expect(actual).toBe(createHash("sha256").update(patch).digest("hex"));
  } finally {
    if (!resolve(repository).startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("TEMP_REPOSITORY_OUTSIDE_TMPDIR");
    rmSync(repository, { recursive: true, force: true });
  }
});
