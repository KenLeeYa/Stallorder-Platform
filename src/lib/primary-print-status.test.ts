import { describe, expect, it } from "vitest";
import { resolvePrimaryPrintStatus } from "@/lib/primary-print-status";

type Job = Parameters<typeof resolvePrimaryPrintStatus>[0][number];
const original: Job = {
  id: "original",
  reprintOfId: null,
  status: "CANCELLED",
  documentType: "KITCHEN_TICKET",
  isRoutingCopy: false,
};
const reprint: Job = { ...original, id: "reprint", reprintOfId: original.id, status: "SUCCEEDED" };

describe("primary ticket print recovery", () => {
  it("has no print status before a primary job exists", () => {
    expect(resolvePrimaryPrintStatus([])).toBeNull();
    expect(resolvePrimaryPrintStatus([reprint])).toBeNull();
  });

  it.each(["FAILED", "CANCELLED"] as const)("accepts a successful reprint after %s", (status) => {
    expect(resolvePrimaryPrintStatus([{ ...original, status }, reprint])).toBe("SUCCEEDED");
  });

  it("accepts a reprint of a failed reprint without rewriting the history", () => {
    const jobs = [
      original,
      { ...reprint, status: "FAILED" as const },
      { ...reprint, id: "second-reprint", reprintOfId: reprint.id },
    ];
    expect(resolvePrimaryPrintStatus(jobs)).toBe("SUCCEEDED");
    expect(jobs.map((job) => job.status)).toEqual(["CANCELLED", "FAILED", "SUCCEEDED"]);
  });

  it.each(["PENDING", "PRINTING", "FAILED", "CANCELLED"] as const)(
    "reports an unsuccessful replacement's %s state without claiming output",
    (status) => {
      expect(resolvePrimaryPrintStatus([original, { ...reprint, status }])).toBe(status);
    },
  );

  it.each([
    { ...reprint, reprintOfId: null, documentType: "CUSTOMER_RECEIPT" as const },
    { ...reprint, documentType: "CUSTOMER_RECEIPT" as const },
    { ...reprint, isRoutingCopy: true },
    { ...reprint, reprintOfId: "unrelated-job" },
  ])("ignores an unrelated receipt, routing copy or detached reprint: %j", (job) => {
    expect(resolvePrimaryPrintStatus([original, job])).toBe("CANCELLED");
  });

  it("does not count a manual reprint of a routing copy as primary output", () => {
    expect(resolvePrimaryPrintStatus([
      original,
      { ...reprint, id: "routing-copy", isRoutingCopy: true, status: "FAILED" },
      { ...reprint, reprintOfId: "routing-copy" },
    ])).toBe("CANCELLED");
  });

  it("keeps confirmed output successful when a later spare copy fails", () => {
    expect(resolvePrimaryPrintStatus([
      original,
      reprint,
      { ...reprint, id: "spare-copy", status: "FAILED" },
    ])).toBe("SUCCEEDED");
    expect(resolvePrimaryPrintStatus([
      { ...original, status: "SUCCEEDED" },
      { ...reprint, status: "CANCELLED" },
    ])).toBe("SUCCEEDED");
  });

  it("resolves ancestry even when timestamps tie and child IDs sort before parents", () => {
    expect(resolvePrimaryPrintStatus([
      original,
      { ...reprint, id: "second", reprintOfId: reprint.id },
      { ...reprint, status: "FAILED" },
    ])).toBe("SUCCEEDED");
  });
});
