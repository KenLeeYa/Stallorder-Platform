import { expect, it } from "vitest";
import { finishPreviewQa, previewQaFailure } from "./qa-preview-cleanup";

it("preserves the principal failure and still attempts every cleanup when later cleanup fails", async () => {
  const failure = Object.assign(Error("PREVIEW_PRINCIPAL_INVALID"), {
    previewPrincipalDiagnostic: { failure: { stage: "principal-response", reason: "PREVIEW_PRINCIPAL_INVALID" } },
  });
  const seen: string[] = [];
  await expect(finishPreviewQa(failure, {
    order: async () => { seen.push("order"); },
    browser: async () => { seen.push("browser"); throw Error("private browser error"); },
    fixture: async () => { seen.push("fixture"); },
    database: async () => { seen.push("database"); throw Error("private DB error"); },
  })).rejects.toMatchObject({ message: "PREVIEW_PRINCIPAL_INVALID",
    previewCleanupFailures: ["browser", "database"],
    previewPrincipalDiagnostic: failure.previewPrincipalDiagnostic });
  expect(seen).toEqual(["order", "browser", "fixture", "database"]);
});
it("does not report success when only cleanup fails", async () => {
  await expect(finishPreviewQa(undefined, {
    order: async () => {}, browser: async () => {}, fixture: async () => { throw Error("secret"); }, database: async () => {},
  })).rejects.toMatchObject({ message: "PREVIEW_ORDER_QA_CLEANUP_FAILED", previewCleanupFailures: ["fixture"] });
});
it("returns only after all cleanup succeeds", async () => {
  await expect(finishPreviewQa(undefined, {
    order: async () => {}, browser: async () => {}, fixture: async () => {}, database: async () => {},
  })).resolves.toBeUndefined();
});
it.each([undefined, null, false, 0, ""])("retains a caught non-Error failure %s after successful cleanup", async (caught) => {
  await expect(finishPreviewQa(previewQaFailure(caught), {
    order: async () => {}, browser: async () => {}, fixture: async () => {}, database: async () => {},
  })).rejects.toMatchObject({ message: "PREVIEW_PUBLIC_ORDER_BROWSER_QA_FAILED" });
});
