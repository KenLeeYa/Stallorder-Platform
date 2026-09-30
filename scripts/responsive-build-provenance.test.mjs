import { expect, test } from "vitest";
import { validateResponsiveBuildProvenance } from "./responsive-build-provenance.mjs";

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
