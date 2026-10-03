import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ data: vi.fn(), authorization: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/messages/merchant-server", () => ({ getRequestMerchantMessages: async () => ({ m: (text: string) => text }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspacePage: async () => ({ workspaces: [{ id: "org", businessName: "QA", roles: ["ORGANIZATION_OWNER"], stalls: [{ id: "stall", slug: "qa", name: "QA", roles: [] }] }] }) }));
vi.mock("@/server/notifications/line-integration-service", () => ({ getLineIntegrationManagerData: state.data, disableLineIntegration: vi.fn(), upsertLineIntegration: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ authorizeStallManagementApiRequest: state.authorization }));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn(), recordAuditEvent: vi.fn() }));
import { EntitlementError } from "@/server/billing/entitlement-service";
import Page from "./page";
import { GET } from "@/app/api/merchant/stalls/[stallId]/line/route";

beforeEach(() => {
  state.data.mockReset();
  state.authorization.mockResolvedValue({ ok: true, workspace: { id: "org" }, requestId: "qa-request" });
});
describe("legacy LINE entitlement boundary", () => {
  it("conceals an unentitled page instead of returning an internal error", async () => {
    state.data.mockRejectedValue(new EntitlementError("FEATURE_NOT_INCLUDED"));
    await expect(Page({ params: Promise.resolve({ stallId: "stall" }) })).rejects.toThrow("NOT_FOUND");
  });
  it("preserves API 403, tracking and a payload without credentials", async () => {
    state.data.mockRejectedValue(new EntitlementError("FEATURE_NOT_INCLUDED"));
    const response = await GET(new Request("https://qa.invalid/api/merchant/stalls/stall/line"), { params: Promise.resolve({ stallId: "stall" }) });
    expect(response.status).toBe(403);
    expect(response.headers.get("x-request-id")).toBe("qa-request");
    expect(await response.json()).toEqual({ code: "FEATURE_NOT_INCLUDED", error: "目前方案未包含此功能，請選擇支援此功能的方案。" });
  });
  it("still renders an explicitly qualified legacy page", async () => {
    state.data.mockResolvedValue({ configured: false });
    expect(await Page({ params: Promise.resolve({ stallId: "stall" }) })).toBeTruthy();
    expect(state.data).toHaveBeenCalledWith("org", "stall");
  });
  it("does not conceal unexpected database or provider failures", async () => {
    state.data.mockRejectedValue(new Error("UNEXPECTED_BACKEND_FAILURE"));
    await expect(Page({ params: Promise.resolve({ stallId: "stall" }) })).rejects.toThrow("UNEXPECTED_BACKEND_FAILURE");
  });
});
