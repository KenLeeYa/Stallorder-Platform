import { expect, test, vi } from "vitest";
import { assertPreviewApproval } from "./preview-approval.mjs";

const environment = { GITHUB_REPOSITORY: "synthetic/repository", GH_TOKEN: "synthetic-secret-never-print" };
test.each([{}, { name: "Preview", protection_rules: [] }, { name: "Preview", protection_rules: null }, { name: "Preview", protection_rules: [{ type: "required_reviewers", reviewers: [] }] },
  { name: "Preview", protection_rules: [{ type: "required_reviewers", reviewers: [{}] }] }, { name: "Production", protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { id: 1 } }] }] }])("missing/malformed protection fails closed: %j", async (configuration) => {
  await expect(assertPreviewApproval(environment, async () => ({ ok: true, json: async () => configuration }))).rejects.toThrow("PREVIEW_APPROVAL_RULE_MISSING_OR_INVALID");
});
test.each([async () => ({ ok: false, status: 403 }), async () => { throw new Error("permission failure synthetic-secret-never-print"); }, async () => ({ ok: true, json: async () => { throw new Error("malformed JSON"); } })])("API/permission/JSON failures reveal no token and never authorize", async (request) => {
  await expect(assertPreviewApproval(environment, request)).rejects.toThrow("PREVIEW_APPROVAL_READ_FAILED");
});
test("only real nonempty required-reviewers shape authorizes; missing inputs do not request", async () => {
  const request = vi.fn(async () => ({ ok: true, json: async () => ({ name: "Preview", protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { id: 1 } }] }] }) }));
  expect(await assertPreviewApproval(environment, request)).toEqual({ status: "PRESENT", reviewerCount: 1, environment: "Preview" });
  expect(request.mock.calls[0][0]).toBe("https://api.github.com/repos/synthetic/repository/environments/Preview");
  request.mockClear(); await expect(assertPreviewApproval({}, request)).rejects.toThrow("PREVIEW_APPROVAL_INPUT_MISSING"); expect(request).not.toHaveBeenCalled();
});
