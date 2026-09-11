import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, createECDH, randomBytes } from "node:crypto";
import { encryptSubscription, pushHash } from "./staff-push-crypto";
const mocks = vi.hoisted(() => ({
  db: { staffPushDelivery: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() }, staffPushSubscription: { update: vi.fn() },
    authSession: { findFirst: vi.fn() }, $queryRaw: vi.fn() },
  access: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/lib/authorization", () => ({ findStallAccess: mocks.access }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send } }));
import { processStaffPushJobs } from "./staff-push-service";
const now = new Date();
let job: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  const ec = createECDH("prime256v1"); ec.generateKeys();
  const publicKey = ec.getPublicKey().toString("base64url");
  const secret = randomBytes(32).toString("base64");
  Object.assign(process.env, { WEB_PUSH_ENABLED: "true", WEB_PUSH_VAPID_PUBLIC_KEY: publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: Buffer.from(ec.getPrivateKey().toString("hex").padStart(64, "0"), "hex").toString("base64url"), WEB_PUSH_ENCRYPTION_KEY: secret,
    WEB_PUSH_VAPID_SUBJECT: "mailto:test@example.com" });
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { auth: randomBytes(16).toString("base64url"), p256dh: publicKey } };
  job = { id: randomUUID(), orderId: randomUUID(), attempts: 1, expiresAt: new Date(now.getTime() + 300_000),
    order: { status: "CONFIRMED" }, subscription: { id: randomUUID(), sessionFamilyId: randomUUID(), sessionVersion: 1,
      profileId: randomUUID(), enabled: true, stall: { slug: "qa" }, vapidKeyHash: pushHash(publicKey),
      encryptedSubscription: encryptSubscription(subscription, secret) } };
  mocks.db.$queryRaw.mockResolvedValue([{ id: job.id }]);
  mocks.db.staffPushDelivery.findUniqueOrThrow.mockResolvedValue(job);
  mocks.db.authSession.findFirst.mockResolvedValue({ id: randomUUID(), profile: { id: randomUUID() } });
  mocks.access.mockResolvedValue({ roles: ["STAFF"] });
  mocks.send.mockResolvedValue({ statusCode: 201 });
});
describe("staff push worker", () => {
  it("sends a minimal new-order payload and never claims device display from provider acceptance", async () => {
    const result = await processStaffPushJobs(now);
    expect(result.results[0].status).toBe("SENT");
    const payload = JSON.parse(mocks.send.mock.calls[0][1]);
    expect(payload).toMatchObject({ type: "STAFF_NEW_ORDER", url: "/staff/qa" });
    expect(payload).not.toHaveProperty("customerName");
    expect(mocks.db.staffPushDelivery.updateMany.mock.calls.at(-1)?.[0].data).not.toHaveProperty("displayedAt");
  });
  it.each(["CANCELLED", "EXPIRED", "COMPLETED"])("does not send for %s orders", async status => {
    job.order = { status };
    const result = await processStaffPushJobs(now);
    expect(result.results[0].status).toBe("CANCELLED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("stops after logout or role removal", async () => {
    mocks.db.authSession.findFirst.mockResolvedValue(null);
    expect((await processStaffPushJobs(now)).results[0].status).toBe("CANCELLED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not deliver to a revoked staff role", async () => {
    mocks.access.mockResolvedValue({ roles: ["KITCHEN"] });
    expect((await processStaffPushJobs(now)).results[0].status).toBe("CANCELLED");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("disables expired subscriptions without retry", async () => {
    mocks.send.mockRejectedValue({ statusCode: 410 });
    expect((await processStaffPushJobs(now)).results[0].errorCode).toBe("SUBSCRIPTION_GONE");
    expect(mocks.db.staffPushSubscription.update).toHaveBeenCalled();
  });
  it("retries transient errors with a lease token and bounded attempts", async () => {
    mocks.send.mockRejectedValue({ statusCode: 503 });
    expect((await processStaffPushJobs(now)).results[0].status).toBe("PENDING");
    expect(mocks.db.staffPushDelivery.updateMany.mock.calls.at(-1)?.[0].where.leaseToken).toBeTruthy();
    job.attempts = 4;
    expect((await processStaffPushJobs(now)).results[0].status).toBe("FAILED");
  });
});
