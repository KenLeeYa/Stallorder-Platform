import { describe, expect, it, vi } from "vitest";

import {
  isTransientAuditFailure,
  runNpmAuditWithRetry,
} from "./run-npm-audit.mjs";

describe("npm dependency audit retry", () => {
  it("classifies the observed registry timeout as transient", () => {
    expect(
      isTransientAuditFailure(
        "npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk\nnpm error audit endpoint returned an error",
      ),
    ).toBe(true);
  });

  it("does not classify a vulnerability result as transient", () => {
    expect(
      isTransientAuditFailure("3 moderate severity vulnerabilities"),
    ).toBe(false);
  });

  it("retries a transient failure and returns the succeeding result", async () => {
    const runAudit = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stdout: "", stderr: "network timeout" })
      .mockReturnValueOnce({ status: 0, stdout: "found 0 vulnerabilities", stderr: "" });
    const wait = vi.fn();
    const write = vi.fn();

    const status = await runNpmAuditWithRetry({ runAudit, wait, write });

    expect(status).toBe(0);
    expect(runAudit).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(10_000);
    expect(write).toHaveBeenCalledWith("stdout", "found 0 vulnerabilities");
  });

  it("fails immediately for a non-transient audit result", async () => {
    const runAudit = vi.fn().mockReturnValue({
      status: 1,
      stdout: "3 moderate severity vulnerabilities",
      stderr: "",
    });
    const wait = vi.fn();

    const status = await runNpmAuditWithRetry({ runAudit, wait, write: vi.fn() });

    expect(status).toBe(1);
    expect(runAudit).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
