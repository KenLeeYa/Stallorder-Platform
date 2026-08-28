import { beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  settingsUpsert: vi.fn(),
  settingsFindUnique: vi.fn(),
  settingsUpdateMany: vi.fn(),
  transaction: vi.fn(),
  enqueueDeletion: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeStallManagementApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mocks.storageUpload,
        remove: mocks.storageRemove,
      })),
    },
  })),
}));
vi.mock("@/server/resilience/storage-replication-service", () => ({
  enqueueStorageDeletion: mocks.enqueueDeletion,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallOrderingSettings: {
      upsert: mocks.settingsUpsert,
      findUnique: mocks.settingsFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-id",
    principal: { user: { id: "55555555-5555-4555-8555-555555555551" } },
    workspace: { id: organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.storageRemove.mockResolvedValue({ error: null });
  mocks.settingsUpsert.mockResolvedValue({ stallId });
  mocks.settingsFindUnique.mockResolvedValue({ orderAlertSoundObjectPath: null });
  mocks.settingsUpdateMany.mockResolvedValue({ count: 1 });
  mocks.enqueueDeletion.mockResolvedValue("deletion-1");
  mocks.recordAuditEvent.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (operation) => operation({
    stallOrderingSettings: { updateMany: mocks.settingsUpdateMany },
  }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-secret");
});

describe("攤位提示音併發更新", () => {
  it("更新條件已失效時回傳 409 並排程清除剛上傳的提示音", async () => {
    mocks.settingsUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await uploadAlertSound();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "提示音已被其他操作更新，請重新整理後再試。",
    });
    expect(mocks.settingsUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        stallId,
        organizationId,
        orderAlertSoundObjectPath: null,
      },
    }));
    expect(mocks.enqueueDeletion).toHaveBeenCalledOnce();
    expect(mocks.enqueueDeletion).toHaveBeenCalledWith(expect.objectContaining({
      organizationId,
      bucket: "alert-sounds",
      objectPath: expect.stringMatching(new RegExp(`^${organizationId}/stall-alerts/${stallId}/[0-9a-f-]{36}\\.mp3$`, "i")),
    }));
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("刪除條件已失效時不會排程刪除另一個請求留下的提示音", async () => {
    const oldPath = `${organizationId}/stall-alerts/${stallId}/00000000-0000-4000-8000-000000000001.mp3`;
    mocks.settingsFindUnique.mockResolvedValueOnce({ orderAlertSoundObjectPath: oldPath });
    mocks.settingsUpdateMany.mockResolvedValueOnce({ count: 0 });
    const route = await import("./route");

    const response = await route.DELETE(new Request(
      `https://example.test/api/merchant/stalls/${stallId}/alert-sound`,
      { method: "DELETE" },
    ), { params: Promise.resolve({ stallId }) });

    expect(response.status).toBe(409);
    expect(mocks.enqueueDeletion).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});

async function uploadAlertSound() {
  const form = new FormData();
  form.set("sound", new File(
    [new Uint8Array([0x49, 0x44, 0x33, 0x04])],
    "alert.mp3",
    { type: "audio/mpeg" },
  ));
  const route = await import("./route");
  return route.POST(new Request(
    `https://example.test/api/merchant/stalls/${stallId}/alert-sound`,
    { method: "POST", body: form },
  ), { params: Promise.resolve({ stallId }) });
}
