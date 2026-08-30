import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AttendanceAttempt, AttendancePolicyCommand } from "@/lib/attendance-contract";
import { zonedCalendarDayUtcRange } from "@/lib/date-time";
import { prisma } from "@/lib/prisma";

const CHALLENGE_TTL_SECONDS = 120;
const ROTATING_CODE_WINDOW_SECONDS = 60;
const LOCATION_MAX_AGE_MS = 30_000;
const LOCATION_FUTURE_TOLERANCE_MS = 10_000;
const REVIEW_SPEED_KMH = 120;
const REJECT_SPEED_KMH = 250;
const SCHEDULE_GRACE_MINUTES = 5;
const SCHEDULE_MATCH_WINDOW_HOURS = 18;

const challengePayloadSchema = z.object({
  sessionId: z.string().uuid(),
  profileId: z.string().uuid(),
  stallId: z.string().uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  expiresAt: z.number().int().positive(),
}).strict();

type ChallengePayload = z.infer<typeof challengePayloadSchema>;
type PolicyForEvaluation = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
  requireRotatingCode: boolean;
};

export class AttendanceError extends Error {
  constructor(
    readonly code:
      | "ATTENDANCE_DISABLED"
      | "ATTENDANCE_POLICY_INCOMPLETE"
      | "CHALLENGE_INVALID"
      | "CHALLENGE_EXPIRED"
      | "CHALLENGE_REPLAYED"
      | "EVENT_NOT_REVIEWABLE",
  ) {
    super(code);
  }
}

export function requireAttendanceSecret(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.ATTENDANCE_CHALLENGE_SECRET?.trim()
    ?? environment.TOKEN_DERIVATION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (environment.NODE_ENV !== "production") return "stallorder-local-attendance-challenge-secret-v1";
  throw new Error("ATTENDANCE_CHALLENGE_SECRET_MISSING");
}

function challengeSignature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`attendance.v1.${encodedPayload}`, "utf8")
    .digest("base64url");
}

export function issueAttendanceChallenge(
  input: Omit<ChallengePayload, "nonce" | "expiresAt">,
  options: { now?: number; secret?: string } = {},
) {
  const now = options.now ?? Date.now();
  const payload = challengePayloadSchema.parse({
    ...input,
    nonce: randomBytes(24).toString("base64url"),
    expiresAt: Math.floor(now / 1000) + CHALLENGE_TTL_SECONDS,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `v1.${encoded}.${challengeSignature(encoded, options.secret ?? requireAttendanceSecret())}`,
    expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
  };
}

export function verifyAttendanceChallenge(
  token: string,
  expected: Omit<ChallengePayload, "nonce" | "expiresAt">,
  options: { now?: number; secret?: string } = {},
) {
  const [version, encoded, supplied, extra] = token.split(".");
  const secret = options.secret ?? requireAttendanceSecret();
  if (version !== "v1" || !encoded || !supplied || extra) {
    throw new AttendanceError("CHALLENGE_INVALID");
  }
  const expectedSignature = Buffer.from(challengeSignature(encoded, secret));
  const actualSignature = Buffer.from(supplied);
  if (
    expectedSignature.length !== actualSignature.length
    || !timingSafeEqual(expectedSignature, actualSignature)
  ) throw new AttendanceError("CHALLENGE_INVALID");

  let payload: ChallengePayload;
  try {
    payload = challengePayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
  } catch {
    throw new AttendanceError("CHALLENGE_INVALID");
  }
  if (payload.expiresAt < Math.floor((options.now ?? Date.now()) / 1000)) {
    throw new AttendanceError("CHALLENGE_EXPIRED");
  }
  if (
    payload.sessionId !== expected.sessionId
    || payload.profileId !== expected.profileId
    || payload.stallId !== expected.stallId
  ) throw new AttendanceError("CHALLENGE_INVALID");
  return payload;
}

export function attendanceNonceHash(nonce: string) {
  return createHash("sha256").update(`attendance:${nonce}`, "utf8").digest("hex");
}

export function currentRotatingAttendanceCode(
  stallId: string,
  options: { now?: number; secret?: string } = {},
) {
  const now = options.now ?? Date.now();
  const window = Math.floor(now / 1000 / ROTATING_CODE_WINDOW_SECONDS);
  return {
    code: rotatingCodeForWindow(stallId, window, options.secret ?? requireAttendanceSecret()),
    expiresAt: new Date((window + 1) * ROTATING_CODE_WINDOW_SECONDS * 1000).toISOString(),
  };
}

export function verifyRotatingAttendanceCode(
  stallId: string,
  supplied: string | undefined,
  options: { now?: number; secret?: string } = {},
) {
  if (!supplied || !/^\d{6}$/.test(supplied)) return false;
  const now = options.now ?? Date.now();
  const window = Math.floor(now / 1000 / ROTATING_CODE_WINDOW_SECONDS);
  const secret = options.secret ?? requireAttendanceSecret();
  return [window, window - 1].some((candidateWindow) => {
    const expected = Buffer.from(rotatingCodeForWindow(stallId, candidateWindow, secret));
    const actual = Buffer.from(supplied);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

function rotatingCodeForWindow(stallId: string, window: number, secret: string) {
  const digest = createHmac("sha256", secret)
    .update(`attendance-code:v1:${stallId}:${window}`, "utf8")
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function haversineDistanceMeters(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(end.latitude - start.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(start.latitude))
    * Math.cos(radians(end.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateAttendanceLocation(input: {
  attempt: AttendanceAttempt;
  policy: PolicyForEvaluation;
  rotatingCodeVerified: boolean;
  previousAccepted?: { latitude: number; longitude: number; occurredAt: Date } | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const capturedAt = new Date(input.attempt.capturedAt).getTime();
  const distanceMeters = haversineDistanceMeters(input.policy, input.attempt);
  const risks: string[] = [];

  if (capturedAt < now - LOCATION_MAX_AGE_MS) risks.push("LOCATION_STALE");
  if (capturedAt > now + LOCATION_FUTURE_TOLERANCE_MS) risks.push("LOCATION_FUTURE");
  if (input.attempt.accuracyMeters > input.policy.maxAccuracyMeters) {
    risks.push("ACCURACY_TOO_POOR");
  }

  const definitelyInside = distanceMeters + input.attempt.accuracyMeters <= input.policy.radiusMeters;
  const definitelyOutside = distanceMeters - input.attempt.accuracyMeters > input.policy.radiusMeters;
  if (definitelyOutside) risks.push("OUTSIDE_GEOFENCE");
  else if (!definitelyInside) risks.push("GEOFENCE_BOUNDARY");

  if (input.policy.requireRotatingCode && !input.rotatingCodeVerified) {
    risks.push("ROTATING_CODE_INVALID");
  }

  if (input.previousAccepted) {
    const elapsedHours = (capturedAt - input.previousAccepted.occurredAt.getTime()) / 3_600_000;
    if (elapsedHours > 0) {
      const travelDistance = haversineDistanceMeters(input.previousAccepted, input.attempt);
      const speedKmh = travelDistance / 1000 / elapsedHours;
      if (speedKmh > REJECT_SPEED_KMH) risks.push("IMPOSSIBLE_TRAVEL");
      else if (speedKmh > REVIEW_SPEED_KMH) risks.push("HIGH_TRAVEL_SPEED");
    }
  }

  const hardReject = risks.some((risk) => [
    "LOCATION_STALE",
    "LOCATION_FUTURE",
    "ACCURACY_TOO_POOR",
    "OUTSIDE_GEOFENCE",
    "GEOFENCE_BOUNDARY",
    "ROTATING_CODE_INVALID",
    "IMPOSSIBLE_TRAVEL",
    "HIGH_TRAVEL_SPEED",
  ].includes(risk));
  return {
    distanceMeters,
    riskCodes: risks,
    decision: hardReject ? "REJECTED" as const : "ACCEPTED" as const,
  };
}

export function attendanceScheduleRisk(input: {
  eventType: AttendanceAttempt["eventType"];
  occurredAt: Date;
  shiftStartAt: Date | null;
  shiftEndAt: Date | null;
  graceMinutes?: number;
}) {
  const graceMs = Math.max(0, input.graceMinutes ?? SCHEDULE_GRACE_MINUTES) * 60_000;
  if (
    input.eventType === "CLOCK_IN"
    && input.shiftStartAt
    && input.occurredAt.getTime() > input.shiftStartAt.getTime() + graceMs
  ) return "LATE_CLOCK_IN" as const;
  if (
    input.eventType === "CLOCK_OUT"
    && input.shiftEndAt
    && input.occurredAt.getTime() < input.shiftEndAt.getTime() - graceMs
  ) return "EARLY_CLOCK_OUT" as const;
  return null;
}

export function nearestAttendanceSchedule(input: {
  eventType: AttendanceAttempt["eventType"];
  occurredAt: Date;
  schedules: Array<{ shiftStartAt: Date | null; shiftEndAt: Date | null }>;
}) {
  const target = input.eventType === "CLOCK_IN" ? "shiftStartAt" : "shiftEndAt";
  return input.schedules.reduce<(typeof input.schedules)[number] | null>((nearest, schedule) => {
    const scheduleTime = schedule[target];
    if (!scheduleTime) return nearest;
    const nearestTime = nearest?.[target];
    if (!nearestTime) return schedule;
    return Math.abs(scheduleTime.getTime() - input.occurredAt.getTime())
      < Math.abs(nearestTime.getTime() - input.occurredAt.getTime())
      ? schedule
      : nearest;
  }, null);
}

export async function getAttendancePolicy(organizationId: string, stallId: string) {
  return prisma.attendancePolicy.findUnique({
    where: { stallId, organizationId },
  });
}

export async function getAttendanceManagerSnapshot(input: {
  organizationId: string;
  stallId: string;
  timezone: string;
}) {
  const range = zonedCalendarDayUtcRange(new Date(), input.timezone);
  const [policy, events] = await Promise.all([
    getAttendancePolicy(input.organizationId, input.stallId),
    prisma.attendanceEvent.findMany({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        occurredAt: { gte: range.from, lt: range.to },
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
      include: {
        profile: { select: { displayName: true } },
        reviewedBy: { select: { displayName: true } },
      },
    }),
  ]);
  const serializedPolicy = policy ? serializeAttendancePolicy(policy) : defaultAttendancePolicy();
  return {
    policy: serializedPolicy,
    rotatingCode: policy?.enabled && policy.requireRotatingCode
      ? currentRotatingAttendanceCode(input.stallId)
      : null,
    records: events.map((event) => ({
      ...serializeAttendanceEvent(event),
      profileName: event.profile.displayName,
      reviewNote: event.reviewNote,
      reviewedAt: event.reviewedAt?.toISOString() ?? null,
      reviewedByName: event.reviewedBy?.displayName ?? null,
    })),
  };
}

export async function getEmployeeAttendanceSnapshot(input: {
  organizationId: string;
  stallId: string;
  profileId: string;
  sessionId: string;
  timezone: string;
}) {
  const policy = await getAttendancePolicy(input.organizationId, input.stallId);
  if (!policy?.enabled) throw new AttendanceError("ATTENDANCE_DISABLED");
  if (policy.latitude === null || policy.longitude === null) {
    throw new AttendanceError("ATTENDANCE_POLICY_INCOMPLETE");
  }
  const range = zonedCalendarDayUtcRange(new Date(), input.timezone);
  const [latestAccepted, records] = await Promise.all([
    prisma.attendanceEvent.findFirst({
      where: {
        stallId: input.stallId,
        profileId: input.profileId,
        decision: "ACCEPTED",
      },
      orderBy: { occurredAt: "desc" },
      select: { eventType: true },
    }),
    prisma.attendanceEvent.findMany({
      where: {
        stallId: input.stallId,
        profileId: input.profileId,
        occurredAt: { gte: range.from, lt: range.to },
      },
      orderBy: { occurredAt: "desc" },
      take: 50,
      select: {
        id: true,
        eventType: true,
        decision: true,
        riskCodes: true,
        occurredAt: true,
        distanceMeters: true,
        accuracyMeters: true,
      },
    }),
  ]);
  return {
    state: latestAccepted?.eventType === "CLOCK_IN" ? "CLOCKED_IN" as const : "CLOCKED_OUT" as const,
    policy: {
      radiusMeters: policy.radiusMeters,
      maxAccuracyMeters: policy.maxAccuracyMeters,
      requireRotatingCode: policy.requireRotatingCode,
    },
    challenge: issueAttendanceChallenge({
      sessionId: input.sessionId,
      profileId: input.profileId,
      stallId: input.stallId,
    }),
    records: records.map(serializeAttendanceEvent),
  };
}

export async function updateAttendancePolicy(input: {
  organizationId: string;
  stallId: string;
  profileId: string;
  command: AttendancePolicyCommand;
}) {
  return prisma.attendancePolicy.upsert({
    where: { stallId: input.stallId },
    create: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      enabled: input.command.enabled,
      latitude: input.command.latitude,
      longitude: input.command.longitude,
      radiusMeters: input.command.radiusMeters,
      maxAccuracyMeters: input.command.maxAccuracyMeters,
      requireRotatingCode: input.command.requireRotatingCode,
      locationEvidenceDays: input.command.locationEvidenceDays,
      updatedByProfileId: input.profileId,
    },
    update: {
      enabled: input.command.enabled,
      latitude: input.command.latitude,
      longitude: input.command.longitude,
      radiusMeters: input.command.radiusMeters,
      maxAccuracyMeters: input.command.maxAccuracyMeters,
      requireRotatingCode: input.command.requireRotatingCode,
      locationEvidenceDays: input.command.locationEvidenceDays,
      updatedByProfileId: input.profileId,
    },
  });
}

export async function submitAttendanceAttempt(input: {
  organizationId: string;
  stallId: string;
  profileId: string;
  sessionId: string;
  attempt: AttendanceAttempt;
}) {
  const challenge = verifyAttendanceChallenge(input.attempt.challengeToken, {
    stallId: input.stallId,
    profileId: input.profileId,
    sessionId: input.sessionId,
  });
  const challengeNonceHash = attendanceNonceHash(challenge.nonce);
  const occurredAt = new Date();
  const scheduleWindow = {
    gte: new Date(occurredAt.getTime() - SCHEDULE_MATCH_WINDOW_HOURS * 60 * 60_000),
    lte: new Date(occurredAt.getTime() + SCHEDULE_MATCH_WINDOW_HOURS * 60 * 60_000),
  };

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`${input.stallId}:${input.profileId}`}, 0)
      )
    `;
    const replay = await transaction.attendanceEvent.findUnique({
      where: { challengeNonceHash },
      select: { id: true },
    });
    if (replay) throw new AttendanceError("CHALLENGE_REPLAYED");

    const [policy, session, latestAccepted, previousLocated, schedules] = await Promise.all([
      transaction.attendancePolicy.findUnique({ where: { stallId: input.stallId } }),
      transaction.authSession.findUnique({
        where: { id: input.sessionId },
        select: { deviceId: true, profileId: true, revokedAt: true, expiresAt: true },
      }),
      transaction.attendanceEvent.findFirst({
        where: { stallId: input.stallId, profileId: input.profileId, decision: "ACCEPTED" },
        orderBy: { occurredAt: "desc" },
        select: { eventType: true },
      }),
      transaction.attendanceEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          profileId: input.profileId,
          decision: "ACCEPTED",
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: { occurredAt: "desc" },
        select: { latitude: true, longitude: true, occurredAt: true },
      }),
      transaction.workforceSchedule.findMany({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          profileId: input.profileId,
          status: "PUBLISHED",
          ...(input.attempt.eventType === "CLOCK_IN"
            ? { shiftStartAt: scheduleWindow }
            : { shiftEndAt: scheduleWindow }),
        },
        take: 8,
        select: { shiftStartAt: true, shiftEndAt: true },
      }),
    ]);
    if (!policy?.enabled) throw new AttendanceError("ATTENDANCE_DISABLED");
    if (policy.latitude === null || policy.longitude === null) {
      throw new AttendanceError("ATTENDANCE_POLICY_INCOMPLETE");
    }

    const deviceBound = Boolean(
      session?.deviceId
      && session.profileId === input.profileId
      && !session.revokedAt
      && session.expiresAt > new Date(),
    );
    const rotatingCodeVerified = policy.requireRotatingCode
      && verifyRotatingAttendanceCode(input.stallId, input.attempt.rotatingCode);
    const evaluation = evaluateAttendanceLocation({
      attempt: input.attempt,
      policy: {
        latitude: Number(policy.latitude),
        longitude: Number(policy.longitude),
        radiusMeters: policy.radiusMeters,
        maxAccuracyMeters: policy.maxAccuracyMeters,
        requireRotatingCode: policy.requireRotatingCode,
      },
      rotatingCodeVerified,
      previousAccepted: previousLocated
        && previousLocated.latitude !== null
        && previousLocated.longitude !== null
        ? {
          latitude: Number(previousLocated.latitude),
          longitude: Number(previousLocated.longitude),
          occurredAt: previousLocated.occurredAt,
        }
        : null,
    });
    const riskCodes = [...evaluation.riskCodes];
    let decision: "ACCEPTED" | "REJECTED" | "REVIEW_REQUIRED" = evaluation.decision;
    if (!deviceBound) {
      riskCodes.push("DEVICE_NOT_BOUND");
      decision = "REJECTED";
    }
    if (
      (input.attempt.eventType === "CLOCK_IN" && latestAccepted?.eventType === "CLOCK_IN")
      || (input.attempt.eventType === "CLOCK_OUT" && latestAccepted?.eventType !== "CLOCK_IN")
    ) {
      riskCodes.push(input.attempt.eventType === "CLOCK_IN" ? "ALREADY_CLOCKED_IN" : "NOT_CLOCKED_IN");
      decision = "REJECTED";
    }
    const schedule = nearestAttendanceSchedule({
      eventType: input.attempt.eventType,
      occurredAt,
      schedules,
    });
    const scheduleRisk = attendanceScheduleRisk({
      eventType: input.attempt.eventType,
      occurredAt,
      shiftStartAt: schedule?.shiftStartAt ?? null,
      shiftEndAt: schedule?.shiftEndAt ?? null,
    });
    if (scheduleRisk && decision === "ACCEPTED") {
      riskCodes.push(scheduleRisk);
      decision = "REVIEW_REQUIRED";
    }

    const event = await transaction.attendanceEvent.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        profileId: input.profileId,
        sessionId: deviceBound ? input.sessionId : null,
        deviceId: deviceBound ? session!.deviceId : null,
        eventType: input.attempt.eventType,
        decision,
        latitude: roundCoordinate(input.attempt.latitude),
        longitude: roundCoordinate(input.attempt.longitude),
        accuracyMeters: roundEvidence(input.attempt.accuracyMeters),
        distanceMeters: roundEvidence(evaluation.distanceMeters),
        clientCapturedAt: new Date(input.attempt.capturedAt),
        riskCodes,
        rotatingCodeVerified,
        challengeNonceHash,
        evidencePurgeAt: new Date(
          occurredAt.getTime() + policy.locationEvidenceDays * 24 * 60 * 60_000,
        ),
        occurredAt,
      },
      select: {
        id: true,
        eventType: true,
        decision: true,
        riskCodes: true,
        occurredAt: true,
        distanceMeters: true,
        accuracyMeters: true,
      },
    });
    return serializeAttendanceEvent(event);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reviewAttendanceEvent(input: {
  organizationId: string;
  stallId: string;
  eventId: string;
  reviewerProfileId: string;
  decision: "ACCEPTED" | "REJECTED";
  note: string;
}) {
  return prisma.$transaction(async (transaction) => {
    const event = await transaction.attendanceEvent.findFirst({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
        stallId: input.stallId,
      },
    });
    if (!event || event.decision !== "REVIEW_REQUIRED") {
      throw new AttendanceError("EVENT_NOT_REVIEWABLE");
    }
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`${input.stallId}:${event.profileId}`}, 0)
      )
    `;
    if (input.decision === "ACCEPTED") {
      const latestAccepted = await transaction.attendanceEvent.findFirst({
        where: { stallId: input.stallId, profileId: event.profileId, decision: "ACCEPTED" },
        orderBy: { occurredAt: "desc" },
        select: { eventType: true },
      });
      if (
        (event.eventType === "CLOCK_IN" && latestAccepted?.eventType === "CLOCK_IN")
        || (event.eventType === "CLOCK_OUT" && latestAccepted?.eventType !== "CLOCK_IN")
      ) throw new AttendanceError("EVENT_NOT_REVIEWABLE");
    }
    const updated = await transaction.attendanceEvent.update({
      where: { id: event.id },
      data: {
        decision: input.decision,
        reviewNote: input.note,
        reviewedByProfileId: input.reviewerProfileId,
        reviewedAt: new Date(),
      },
      select: {
        id: true,
        eventType: true,
        decision: true,
        riskCodes: true,
        occurredAt: true,
        distanceMeters: true,
        accuracyMeters: true,
      },
    });
    return serializeAttendanceEvent(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function serializeAttendanceEvent(event: {
  id: string;
  eventType: string;
  decision: string;
  riskCodes: string[];
  occurredAt: Date;
  distanceMeters: { toString(): string } | null;
  accuracyMeters: { toString(): string } | null;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    decision: event.decision,
    riskCodes: event.riskCodes,
    occurredAt: event.occurredAt.toISOString(),
    distanceMeters: event.distanceMeters === null ? null : Number(event.distanceMeters),
    accuracyMeters: event.accuracyMeters === null ? null : Number(event.accuracyMeters),
  };
}

function roundCoordinate(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function roundEvidence(value: number) {
  return Math.round(value * 100) / 100;
}

function serializeAttendancePolicy(policy: {
  enabled: boolean;
  latitude: { toString(): string } | null;
  longitude: { toString(): string } | null;
  radiusMeters: number;
  maxAccuracyMeters: number;
  requireRotatingCode: boolean;
  locationEvidenceDays: number;
}) {
  return {
    enabled: policy.enabled,
    latitude: policy.latitude === null ? null : Number(policy.latitude),
    longitude: policy.longitude === null ? null : Number(policy.longitude),
    radiusMeters: policy.radiusMeters,
    maxAccuracyMeters: policy.maxAccuracyMeters,
    requireRotatingCode: policy.requireRotatingCode,
    locationEvidenceDays: policy.locationEvidenceDays,
  };
}

function defaultAttendancePolicy() {
  return {
    enabled: false,
    latitude: null,
    longitude: null,
    radiusMeters: 150,
    maxAccuracyMeters: 80,
    requireRotatingCode: true,
    locationEvidenceDays: 90,
  };
}
