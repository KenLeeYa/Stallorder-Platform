import { beforeEach, describe, expect, it } from "vitest";
import {
  attendanceScheduleRisk,
  currentRotatingAttendanceCode,
  evaluateAttendanceLocation,
  haversineDistanceMeters,
  issueAttendanceChallenge,
  nearestAttendanceSchedule,
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

  it("blocks an uncertain boundary reading instead of sending location risk to supervisor review", () => {
    const roughly140mNorth = 25.03426;
    const result = evaluateAttendanceLocation({
      attempt: attempt({ latitude: roughly140mNorth, accuracyMeters: 30 }),
      policy: { ...policy, requireRotatingCode: false },
      rotatingCodeVerified: false,
      now,
    });
    expect(result.decision).toBe("REJECTED");
    expect(result.riskCodes).toContain("GEOFENCE_BOUNDARY");
  });

  it("only marks scheduled late arrival and early departure for supervisor review", () => {
    const scheduledStart = new Date("2026-08-28T08:00:00.000Z");
    const scheduledEnd = new Date("2026-08-28T16:00:00.000Z");
    expect(attendanceScheduleRisk({
      eventType: "CLOCK_IN",
      occurredAt: new Date("2026-08-28T08:06:00.000Z"),
      shiftStartAt: scheduledStart,
      shiftEndAt: scheduledEnd,
    })).toBe("LATE_CLOCK_IN");
    expect(attendanceScheduleRisk({
      eventType: "CLOCK_OUT",
      occurredAt: new Date("2026-08-28T15:54:00.000Z"),
      shiftStartAt: scheduledStart,
      shiftEndAt: scheduledEnd,
    })).toBe("EARLY_CLOCK_OUT");
    expect(attendanceScheduleRisk({
      eventType: "CLOCK_IN",
      occurredAt: new Date("2026-08-28T08:05:00.000Z"),
      shiftStartAt: scheduledStart,
      shiftEndAt: scheduledEnd,
    })).toBeNull();
  });

  it("matches clock-in and clock-out to the nearest corresponding shift boundary", () => {
    const morning = {
      shiftStartAt: new Date("2026-08-28T08:00:00.000Z"),
      shiftEndAt: new Date("2026-08-28T12:00:00.000Z"),
    };
    const evening = {
      shiftStartAt: new Date("2026-08-28T17:00:00.000Z"),
      shiftEndAt: new Date("2026-08-28T21:00:00.000Z"),
    };
    expect(nearestAttendanceSchedule({
      eventType: "CLOCK_IN",
      occurredAt: new Date("2026-08-28T16:55:00.000Z"),
      schedules: [morning, evening],
    })).toBe(evening);
    expect(nearestAttendanceSchedule({
      eventType: "CLOCK_OUT",
      occurredAt: new Date("2026-08-28T12:05:00.000Z"),
      schedules: [morning, evening],
    })).toBe(morning);
  });

  it("does not invent a schedule when the relevant boundary is missing", () => {
    expect(nearestAttendanceSchedule({
      eventType: "CLOCK_IN",
      occurredAt: new Date("2026-08-28T08:00:00.000Z"),
      schedules: [{ shiftStartAt: null, shiftEndAt: new Date("2026-08-28T16:00:00.000Z") }],
    })).toBeNull();
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
