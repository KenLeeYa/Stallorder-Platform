import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit", () => ({ logEvent }));

import {
  deliverNotificationOutbox,
  dispatchClaimedNotificationOutbox,
  OutboxDeliveryError,
  type ClaimedNotificationOutbox,
} from "./outbox-dispatcher";

const now = new Date("2026-08-13T00:00:00.000Z");
const claimed: ClaimedNotificationOutbox = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: "11111111-1111-4111-8111-111111111111",
  billingNotificationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  channel: "IN_APP",
  attemptCount: 1,
  maxAttempts: 5,
  deliveryKey: "notification-outbox:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("outbox failure injection", () => {
  it("does not report EMAIL delivery when the provider is disabled", async () => {
    await expect(deliverNotificationOutbox({ ...claimed, channel: "EMAIL" }))
      .rejects.toMatchObject({ code: "EMAIL_PROVIDER_NOT_ENABLED", retryable: false });
  });

  it("treats the already-persisted IN_APP notification as a local no-op delivery", async () => {
    await expect(deliverNotificationOutbox(claimed)).resolves.toBeUndefined();
  });

  it("keeps the stable idempotency key when the worker crashes after delivery", async () => {
    const deliveredKeys: string[] = [];
    const deliver = vi.fn(async (entry: ClaimedNotificationOutbox) => {
      deliveredKeys.push(entry.deliveryKey);
    });
    const firstComplete = vi.fn().mockRejectedValue(new Error("INJECTED_CRASH_AFTER_SEND"));
    const fail = vi.fn();

    await expect(dispatchClaimedNotificationOutbox(claimed, "worker-a", now, {
      deliver,
      complete: firstComplete,
      fail,
    })).rejects.toThrow("INJECTED_CRASH_AFTER_SEND");
    expect(fail).not.toHaveBeenCalled();

    const complete = vi.fn().mockResolvedValue(true);
    await expect(dispatchClaimedNotificationOutbox(
      { ...claimed, attemptCount: 2 },
      "worker-b",
      new Date("2026-08-13T00:11:00.000Z"),
      { deliver, complete, fail },
    )).resolves.toMatchObject({ status: "DELIVERED" });
    expect(deliveredKeys).toEqual([claimed.deliveryKey, claimed.deliveryKey]);
  });

  it("makes duplicate delivery reentrant through the same delivery key", async () => {
    const providerKeys = new Set<string>();
    const deliver = vi.fn(async (entry: ClaimedNotificationOutbox) => {
      providerKeys.add(entry.deliveryKey);
    });
    const complete = vi.fn().mockResolvedValue(true);
    const fail = vi.fn();

    await dispatchClaimedNotificationOutbox(claimed, "worker-a", now, { deliver, complete, fail });
    await dispatchClaimedNotificationOutbox(
      { ...claimed, attemptCount: 2 },
      "worker-b",
      new Date("2026-08-13T00:11:00.000Z"),
      { deliver, complete, fail },
    );

    expect(providerKeys.size).toBe(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("schedules a bounded retry after a provider timeout", async () => {
    const retryAt = new Date("2026-08-13T00:01:00.000Z");
    const fail = vi.fn().mockResolvedValue("RETRY_PENDING");

    const result = await dispatchClaimedNotificationOutbox(claimed, "worker-a", now, {
      deliver: vi.fn().mockRejectedValue(new OutboxDeliveryError("OUTBOX_PROVIDER_TIMEOUT", true)),
      complete: vi.fn(),
      fail,
    });

    expect(result).toEqual({
      outboxId: claimed.id,
      status: "RETRY_PENDING",
      retryAt: retryAt.toISOString(),
    });
    expect(fail).toHaveBeenCalledWith({
      outboxId: claimed.id,
      workerId: "worker-a",
      errorCode: "OUTBOX_PROVIDER_TIMEOUT",
      retryAt,
      now,
    });
    expect(logEvent).toHaveBeenLastCalledWith(
      "warn",
      "NOTIFICATION_OUTBOX_DELIVERY_FAILED",
      {
        outboxId: claimed.id,
        channel: "IN_APP",
        attemptCount: 1,
        errorCode: "OUTBOX_PROVIDER_TIMEOUT",
        retryable: true,
      },
    );
    expect(Object.keys(logEvent.mock.lastCall?.[2] ?? {}).sort()).toEqual([
      "attemptCount",
      "channel",
      "errorCode",
      "outboxId",
      "retryable",
    ]);
  });
});
