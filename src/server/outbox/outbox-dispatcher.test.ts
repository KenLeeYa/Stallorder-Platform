import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyOutboxHealth,
  outboxRetryAt,
  type OutboxHealthSnapshot,
} from "./outbox-dispatcher";

describe("outbox dispatch safety helpers", () => {
  it("uses bounded retries and stops when the attempt budget is exhausted", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");

    expect(outboxRetryAt(1, 5, true, now)?.toISOString())
      .toBe("2026-08-13T00:01:00.000Z");
    expect(outboxRetryAt(3, 5, true, now)?.toISOString())
      .toBe("2026-08-13T00:15:00.000Z");
    expect(outboxRetryAt(5, 5, true, now)).toBeNull();
    expect(outboxRetryAt(1, 5, false, now)).toBeNull();
  });

  it("raises only aggregate, PII-free queue health signals", () => {
    const snapshot: OutboxHealthSnapshot = {
      pendingDepth: 101,
      oldestPendingAgeSeconds: 601,
      deadLetterDepth: 2,
    };

    expect(classifyOutboxHealth(snapshot)).toEqual([
      "NOTIFICATION_OUTBOX_PENDING_DEPTH_HIGH",
      "NOTIFICATION_OUTBOX_PENDING_AGE_HIGH",
      "NOTIFICATION_OUTBOX_DEAD_LETTER_PRESENT",
    ]);
    expect(classifyOutboxHealth({
      pendingDepth: 1,
      oldestPendingAgeSeconds: 10,
      deadLetterDepth: 0,
    })).toEqual([]);
  });
});
