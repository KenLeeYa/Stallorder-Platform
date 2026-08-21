import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createReservationRecord: vi.fn(),
  modifyReservationRecord: vi.fn(),
  cancelReservationRecord: vi.fn(),
  issueReservationPreorderSessionRecord: vi.fn(),
}));

vi.mock("@/server/reservations/reservation-repository", () => mocks);

const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  stallId: "22222222-2222-4222-8222-222222222222",
};

describe("reservation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABUSE_HASH_SECRET", "reservation-test-abuse-secret");
    vi.stubEnv("TOKEN_DERIVATION_SECRET", "reservation-test-token-secret");
  });

  it("creates a reservation while persisting only a one-way public token hash", async () => {
    mocks.createReservationRecord.mockResolvedValue({
      ok: true,
      reservationId: "33333333-3333-4333-8333-333333333333",
      status: "CONFIRMED",
      version: 1,
      startsAt: "2099-01-01T04:00:00+00:00",
      endsAt: "2099-01-01T05:00:00+00:00",
      preorderOpensAt: "2098-12-31T04:00:00+00:00",
      preorderCutoffAt: "2099-01-01T03:30:00+00:00",
    });
    const { createReservation } = await import("./reservation-service");

    const result = await createReservation({
      ...scope,
      diningTableId: "44444444-4444-4444-8444-444444444444",
      partySize: 4,
      startsAt: "2099-01-01T04:00:00.000Z",
      endsAt: "2099-01-01T05:00:00.000Z",
      timezone: "Asia/Taipei",
      requestId: "reservation-create-test",
      actorProfileId: null,
    });

    expect(result.reservationToken).toMatch(/^str_[A-Za-z0-9_-]{43}$/);
    expect(mocks.createReservationRecord).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      publicTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(mocks.createReservationRecord.mock.calls[0]?.[0]).not.toHaveProperty("reservationToken");
    expect(mocks.createReservationRecord.mock.calls[0]?.[0].publicTokenHash)
      .not.toContain(result.reservationToken);
  });

  it("fails closed when the database feature gate is disabled", async () => {
    mocks.createReservationRecord.mockResolvedValue({
      ok: false,
      code: "RESERVATION_FEATURE_DISABLED",
    });
    const { createReservation } = await import("./reservation-service");

    await expect(createReservation({
      ...scope,
      diningTableId: "44444444-4444-4444-8444-444444444444",
      partySize: 2,
      startsAt: "2099-01-01T04:00:00.000Z",
      endsAt: "2099-01-01T05:00:00.000Z",
      timezone: "Asia/Taipei",
      requestId: "reservation-disabled-test",
      actorProfileId: null,
    })).rejects.toMatchObject({
      code: "RESERVATION_FEATURE_DISABLED",
      status: 503,
    });
  });

  it("issues an opaque session only after the authoritative reservation RPC succeeds", async () => {
    mocks.issueReservationPreorderSessionRecord.mockResolvedValue({
      ok: true,
      sessionId: "55555555-5555-4555-8555-555555555555",
      reservationId: "33333333-3333-4333-8333-333333333333",
      reservationVersion: 2,
      scheduledFor: "2099-01-01T04:00:00+00:00",
      expiresAt: "2099-01-01T03:30:00+00:00",
      idempotentReplay: false,
    });
    const { issueReservationPreorderSession } = await import("./reservation-service");

    const result = await issueReservationPreorderSession({
      reservationToken: `str_${"a".repeat(43)}`,
      deviceId: "66666666-6666-4666-8666-666666666666",
      sessionRequestId: "77777777-7777-4777-8777-777777777777",
      requestId: "reservation-session-test",
    });

    expect(result.sessionToken).toMatch(/^strps_[A-Za-z0-9_-]{43}$/);
    expect(mocks.issueReservationPreorderSessionRecord).toHaveBeenCalledWith({
      reservationTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      sessionTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      deviceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      sessionRequestId: "77777777-7777-4777-8777-777777777777",
      requestId: "reservation-session-test",
    });
    const repositoryInput = mocks.issueReservationPreorderSessionRecord.mock.calls[0]?.[0];
    expect(JSON.stringify(repositoryInput)).not.toContain(result.sessionToken);
    expect(JSON.stringify(repositoryInput)).not.toContain(`str_${"a".repeat(43)}`);
  });

  it("returns one indistinguishable invalid-reservation error and never manufactures a session", async () => {
    mocks.issueReservationPreorderSessionRecord.mockResolvedValue({
      ok: false,
      code: "RESERVATION_INVALID",
    });
    const { issueReservationPreorderSession } = await import("./reservation-service");

    await expect(issueReservationPreorderSession({
      reservationToken: `str_${"b".repeat(43)}`,
      deviceId: "66666666-6666-4666-8666-666666666666",
      sessionRequestId: "77777777-7777-4777-8777-777777777777",
      requestId: "reservation-invalid-test",
    })).rejects.toMatchObject({
      code: "RESERVATION_INVALID",
      status: 404,
    });
  });

  it("passes trusted tenant scope and expected versions to modify and cancel", async () => {
    mocks.modifyReservationRecord.mockResolvedValue({
      ok: true,
      reservationId: "33333333-3333-4333-8333-333333333333",
      status: "CONFIRMED",
      version: 3,
      startsAt: "2099-01-01T05:00:00+00:00",
      endsAt: "2099-01-01T06:00:00+00:00",
    });
    mocks.cancelReservationRecord.mockResolvedValue({
      ok: true,
      reservationId: "33333333-3333-4333-8333-333333333333",
      status: "CANCELLED",
      version: 4,
      refundStatus: "NOT_APPLICABLE",
      idempotentReplay: false,
    });
    const { cancelReservation, modifyReservation } = await import("./reservation-service");

    await modifyReservation({
      ...scope,
      reservationId: "33333333-3333-4333-8333-333333333333",
      expectedVersion: 2,
      diningTableId: "44444444-4444-4444-8444-444444444444",
      partySize: 5,
      startsAt: "2099-01-01T05:00:00.000Z",
      endsAt: "2099-01-01T06:00:00.000Z",
      timezone: "Asia/Taipei",
      requestId: "reservation-modify-test",
      actorProfileId: null,
    });
    await cancelReservation({
      ...scope,
      reservationId: "33333333-3333-4333-8333-333333333333",
      expectedVersion: 3,
      reasonCode: "CUSTOMER_REQUEST",
      requestId: "reservation-cancel-test",
      actorProfileId: null,
    });

    expect(mocks.modifyReservationRecord).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      expectedVersion: 2,
    }));
    expect(mocks.cancelReservationRecord).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      expectedVersion: 3,
      reasonCode: "CUSTOMER_REQUEST",
    }));
  });
});
