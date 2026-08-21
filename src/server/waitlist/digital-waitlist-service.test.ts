import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOpaqueToken: vi.fn(),
  hashToken: vi.fn((value: string) => `hash:${value}`),
  joinWaitlist: vi.fn(),
  getWaitlistStatus: vi.fn(),
  transitionWaitlistEntry: vi.fn(),
  exchangeWaitlistSeating: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/security", () => ({
  createOpaqueToken: mocks.createOpaqueToken,
  hashToken: mocks.hashToken,
}));
vi.mock("@/server/waitlist/digital-waitlist-repository", () => ({
  joinWaitlist: mocks.joinWaitlist,
  getWaitlistStatus: mocks.getWaitlistStatus,
  transitionWaitlistEntry: mocks.transitionWaitlistEntry,
  exchangeWaitlistSeating: mocks.exchangeWaitlistSeating,
}));

import {
  exchangeDigitalWaitlistSeating,
  getDigitalWaitlistStatus,
  joinDigitalWaitlist,
  transitionDigitalWaitlistEntry,
} from "@/server/waitlist/digital-waitlist-service";

describe("digital waitlist service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ABUSE_HASH_SECRET = "test-abuse-secret";
  });

  it("hashes public and duplicate credentials before joining", async () => {
    mocks.createOpaqueToken.mockReturnValueOnce("raw-public-token");
    mocks.joinWaitlist.mockResolvedValue({
      ok: true,
      code: "WAITLIST_JOINED",
      entry_id: "entry-1",
      status: "WAITING",
      position: 2,
      joined_at: "2026-08-13T01:00:00.000Z",
    });

    const result = await joinDigitalWaitlist({
      stallId: "22222222-2222-4222-8222-222222222222",
      partySize: 2,
      displayName: "測試候位",
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ipHash: "b".repeat(64),
      requestId: "request-join",
    });

    expect(mocks.joinWaitlist).toHaveBeenCalledWith(expect.objectContaining({
      publicTokenHash: "hash:raw-public-token",
      duplicateKeyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(result).toEqual({
      publicToken: "raw-public-token",
      entryId: "entry-1",
      status: "WAITING",
      position: 2,
      joinedAt: "2026-08-13T01:00:00.000Z",
    });
  });

  it("hashes the public token for status lookup", async () => {
    mocks.getWaitlistStatus.mockResolvedValue({
      ok: true,
      code: "WAITLIST_STATUS",
      entry_id: "entry-1",
      stall_id: "stall-1",
      display_name: "候位客",
      party_size: 3,
      status: "NOTIFIED",
      state_version: 2,
      position: 1,
      hold_expires_at: "2026-08-13T01:10:00.000Z",
      table_label: null,
      updated_at: "2026-08-13T01:00:00.000Z",
    });

    const result = await getDigitalWaitlistStatus("raw-public-token");

    expect(mocks.getWaitlistStatus).toHaveBeenCalledWith("hash:raw-public-token");
    expect(result.status).toBe("NOTIFIED");
    expect(result).not.toHaveProperty("publicToken");
  });

  it("records NOTIFY without creating a seating credential", async () => {
    mocks.transitionWaitlistEntry.mockResolvedValue({
      ok: true,
      code: "WAITLIST_STATE_CHANGED",
      entry_id: "entry-1",
      status: "NOTIFIED",
      state_version: 2,
      hold_expires_at: "2026-08-13T01:10:00.000Z",
      seating_exchange_expires_at: null,
      assigned_dining_table_id: null,
    });

    const result = await transitionDigitalWaitlistEntry({
      organizationId: "11111111-1111-4111-8111-111111111111",
      stallId: "22222222-2222-4222-8222-222222222222",
      entryId: "33333333-3333-4333-8333-333333333333",
      expectedVersion: 1,
      operation: "NOTIFY",
      diningTableId: null,
      actorProfileId: "55555555-5555-4555-8555-555555555555",
      ipHash: "b".repeat(64),
      requestId: "request-notify",
    });

    expect(mocks.createOpaqueToken).not.toHaveBeenCalled();
    expect(mocks.transitionWaitlistEntry).toHaveBeenCalledWith(expect.objectContaining({
      seatingTokenHash: null,
    }));
    expect(result.seatingToken).toBeNull();
  });

  it("creates a one-time seating token only for the staff SEAT transition", async () => {
    mocks.createOpaqueToken.mockReturnValueOnce("raw-seating-token");
    mocks.transitionWaitlistEntry.mockResolvedValue({
      ok: true,
      code: "WAITLIST_STATE_CHANGED",
      entry_id: "entry-1",
      status: "SEATED",
      state_version: 3,
      hold_expires_at: "2026-08-13T01:10:00.000Z",
      seating_exchange_expires_at: "2026-08-13T01:20:00.000Z",
      assigned_dining_table_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    const result = await transitionDigitalWaitlistEntry({
      organizationId: "11111111-1111-4111-8111-111111111111",
      stallId: "22222222-2222-4222-8222-222222222222",
      entryId: "33333333-3333-4333-8333-333333333333",
      expectedVersion: 2,
      operation: "SEAT",
      diningTableId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      actorProfileId: "55555555-5555-4555-8555-555555555555",
      ipHash: "b".repeat(64),
      requestId: "request-seat",
    });

    expect(mocks.transitionWaitlistEntry).toHaveBeenCalledWith(expect.objectContaining({
      seatingTokenHash: "hash:raw-seating-token",
    }));
    expect(result.seatingToken).toBe("raw-seating-token");
  });

  it("exchanges two waitlist credentials for a distinct new dine-in session token", async () => {
    mocks.createOpaqueToken.mockReturnValueOnce("new-order-session-token");
    mocks.exchangeWaitlistSeating.mockResolvedValue({
      ok: true,
      code: "DINE_IN_SESSION_ISSUED",
      organization_id: "org-1",
      stall_id: "stall-1",
      qr_code_id: "qr-1",
      dining_table_id: "table-1",
      order_session_id: "session-1",
      ordering_mode: "DEFAULT",
      expires_at: "2026-08-13T01:15:00.000Z",
    });

    const result = await exchangeDigitalWaitlistSeating({
      publicToken: "raw-public-token",
      seatingToken: "raw-seating-token",
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ipHash: "b".repeat(64),
      requestId: "request-exchange",
    });

    expect(mocks.exchangeWaitlistSeating).toHaveBeenCalledWith(expect.objectContaining({
      publicTokenHash: "hash:raw-public-token",
      seatingTokenHash: "hash:raw-seating-token",
      sessionTokenHash: "hash:new-order-session-token",
      deviceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(result).toEqual(expect.objectContaining({
      orderSessionToken: "new-order-session-token",
      orderingMode: "DEFAULT",
      diningTableId: "table-1",
    }));
    expect(result.orderSessionToken).not.toBe("raw-public-token");
    expect(result.orderSessionToken).not.toBe("raw-seating-token");
  });

  it("fails closed when the database reports that the feature is disabled", async () => {
    mocks.joinWaitlist.mockResolvedValue({
      ok: false,
      code: "DIGITAL_WAITLIST_DISABLED",
    });
    mocks.createOpaqueToken.mockReturnValueOnce("unused-token");

    await expect(joinDigitalWaitlist({
      stallId: "22222222-2222-4222-8222-222222222222",
      partySize: 2,
      displayName: "候位客",
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ipHash: "b".repeat(64),
      requestId: "request-disabled",
    })).rejects.toMatchObject({ code: "DIGITAL_WAITLIST_DISABLED", status: 404 });
  });
});
