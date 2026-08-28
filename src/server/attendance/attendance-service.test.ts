import { beforeEach, describe, expect, it } from "vitest";
import {
  currentRotatingAttendanceCode,
  evaluateAttendanceLocation,
  haversineDistanceMeters,
  issueAttendanceChallenge,
  verifyAttendanceChallenge,
  verifyRotatingAttendanceCode,
} from "@/server/attendance/attendance-service";

const secret = "attendance-test-secret-that-is-at-least-32-bytes";
const sessionId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const stallId = "33333333-3333-4333-8333-333333333333";
const now = Date.parse("2026-08-28T08:00:00.000Z");

beforeEach(() => {
  process.env.ATTENDANCE_CHALLENGE_SECRET = secret;
});

describe("attendance challenge", () => {
  it("binds a short-lived one-time payload to session, profile and stall", () => {
    const issued = issueAttendanceChallenge({ sessionId, profileId, stallId }, { now, secret });
    expect(verifyAttendanceChallenge(issued.token, { sessionId, profileId, stallId }, { now, secret }))
      .toMatchObject({ sessionId, profileId, stallId });
    expect(() => verifyAttendanceChallenge(
      issued.token,
      { sessionId, profileId, stallId: "44444444-4444-4444-8444-444444444444" },
      { now, secret },
    )).toThrow("CHALLENGE_INVALID");
    expect(() => verifyAttendanceChallenge(
      issued.token,
      { sessionId, profileId, stallId },
      { now: now + 121_000, secret },
    )).toThrow("CHALLENGE_EXPIRED");
  });

  it("accepts the current and previous rotating code window only", () => {
    const current = currentRotatingAttendanceCode(stallId, { now, secret });
    expect(verifyRotatingAttendanceCode(stallId, current.code, { now, secret })).toBe(true);
    expect(verifyRotatingAttendanceCode(stallId, current.code, { now: now + 61_000, secret })).toBe(true);
    expect(verifyRotatingAttendanceCode(stallId, current.code, { now: now + 121_000, secret })).toBe(false);
  });
});

describe("attendance geofence", () => {
  const policy = {
    latitude: 25.033,
    longitude: 121.5654,
    radiusMeters: 150,
    maxAccuracyMeters: 80,
    requireRotatingCode: true,
  };

  function attempt(overrides: Record<string, unknown> = {}) {
    return {
      eventType: "CLOCK_IN" as const,
      challengeToken: "x".repeat(40),
      latitude: 25.033,
      longitude: 121.5654,
      accuracyMeters: 15,
      capturedAt: new Date(now).toISOString(),
      rotatingCode: "123456",
      clientPlatform: "WEB" as const,
      ...overrides,
    };
  }

  it("accepts a fresh accurate reading inside the radius with on-site proof", () => {
    expect(evaluateAttendanceLocation({
      attempt: attempt(),
      policy,
      rotatingCodeVerified: true,
      now,
    })).toMatchObject({ decision: "ACCEPTED", riskCodes: [] });
  });

  it("rejects an outside reading and an invalid on-site code", () => {
    const result = evaluateAttendanceLocation({
      attempt: attempt({ latitude: 25.043 }),
      policy,
      rotatingCodeVerified: false,
      now,
    });
    expect(result.decision).toBe("REJECTED");
    expect(result.riskCodes).toEqual(expect.arrayContaining([
      "OUTSIDE_GEOFENCE",
      "ROTATING_CODE_INVALID",
    ]));
  });

  it("uses accuracy-aware boundary review instead of a brittle single radius", () => {
    const roughly140mNorth = 25.03426;
    const result = evaluateAttendanceLocation({
      attempt: attempt({ latitude: roughly140mNorth, accuracyMeters: 30 }),
      policy: { ...policy, requireRotatingCode: false },
      rotatingCodeVerified: false,
      now,
    });
    expect(result.decision).toBe("REVIEW_REQUIRED");
    expect(result.riskCodes).toContain("GEOFENCE_BOUNDARY");
  });

  it("flags impossible travel as a hard rejection", () => {
    const result = evaluateAttendanceLocation({
      attempt: attempt(),
      policy,
      rotatingCodeVerified: true,
      previousAccepted: {
        latitude: 22.6273,
        longitude: 120.3014,
        occurredAt: new Date(now - 10 * 60_000),
      },
      now,
    });
    expect(result.decision).toBe("REJECTED");
    expect(result.riskCodes).toContain("IMPOSSIBLE_TRAVEL");
  });

  it("calculates a stable server-side Haversine distance", () => {
    const distance = haversineDistanceMeters(
      { latitude: 25.033, longitude: 121.5654 },
      { latitude: 25.034, longitude: 121.5654 },
    );
    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });
});
