import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { pushPlatformSnapshot,readPlatformQuota,verifyPlatformBotIdentity } from "./messaging";

const body = JSON.stringify({ to: `U${"1".repeat(32)}`, messages: [{ type: "text", text: "測試店：請取餐" }], notificationDisabled: false });
const operation = { body, payloadHash: createHash("sha256").update(body).digest("hex"), retryKey: "11111111-1111-4111-8111-111111111111", firstRequestAt: new Date("2026-09-27T00:00:00Z") };
describe("platform OA immutable Push operation", () => {
  it("recovers an already accepted retry without sending a different request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message: "The retry key is already accepted" }), { status: 409, headers: { "x-line-accepted-request-id": "accepted-1", "x-line-request-id": "request-2" } }));
    await expect(pushPlatformSnapshot(operation, "synthetic-token", new Date("2026-09-27T01:00:00Z"), fetchImpl)).resolves.toMatchObject({ outcome: "PROVIDER_ACCEPTED", acceptedRequestId: "accepted-1" });
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(body);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("x-line-retry-key")).toBe(operation.retryKey);
  });
  it("does not call LINE for changed content or a retry outside its original 24 hour window", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(pushPlatformSnapshot({ ...operation, body: body.replace("請取餐", "已取消") }, "token", new Date("2026-09-27T01:00:00Z"), fetchImpl)).resolves.toMatchObject({ outcome: "MANUAL_REVIEW", errorCode: "SNAPSHOT_MISMATCH" });
    await expect(pushPlatformSnapshot(operation, "token", new Date("2026-09-28T00:00:00Z"), fetchImpl)).resolves.toMatchObject({ outcome: "MANUAL_REVIEW", errorCode: "RETRY_WINDOW_EXPIRED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([[400, "invalid", "FAILED"], [401, "invalid", "FAILED"], [409, "unrelated conflict", "FAILED"], [429, "You have reached your monthly limit.", "QUOTA_BLOCKED"], [429, "The API rate limit has been exceeded.", "RETRY_SCHEDULED"], [503, "unavailable", "RETRY_SCHEDULED"]])("classifies HTTP %i (%s)", async (status, message, outcome) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ message }), { status }));
    await expect(pushPlatformSnapshot(operation, "token", new Date("2026-09-27T01:00:00Z"), fetchImpl)).resolves.toMatchObject({ outcome });
  });
  it("rejects a token belonging to another OA before any Push",async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({userId:`U${'b'.repeat(32)}`}));
    await expect(verifyPlatformBotIdentity('synthetic-token',`U${'a'.repeat(32)}`,transport)).rejects.toThrow('PLATFORM_SENDER_MISMATCH');
    expect(transport.mock.calls[0][0]).toBe('https://api.line.me/v2/bot/info');
  });
  it("does not interpret an unknown quota response as unlimited",async()=>{
    const transport=vi.fn<typeof fetch>().mockImplementation(async url=>Response.json(String(url).endsWith('/consumption') ? {totalUsage:1} : {type:'unknown'}));
    await expect(readPlatformQuota('synthetic-token',transport)).rejects.toThrow('LINE_QUOTA_INVALID');
  });
});
