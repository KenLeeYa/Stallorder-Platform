import "server-only";

import type { PrismaClient } from "@prisma/client";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getDrPrismaClient, isDrDatabaseConfigured } from "@/server/resilience/database-targets";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";
import { checkDrDatabaseHealth } from "@/server/resilience/health-service";

export const databaseReadPolicies = [
  "PRIMARY_ONLY",
  "DR_PREFERRED_EVENTUAL",
] as const;

export type DatabaseReadPolicy = (typeof databaseReadPolicies)[number];
export type DatabaseReadTarget = "PRIMARY" | "DR";

export type ReplicationReadinessSnapshot = {
  status: string;
  lagSeconds: number | null;
  schemaCompatible: boolean;
  observedAt: Date;
};

export type ReadTargetDecision = {
  target: DatabaseReadTarget;
  reason:
    | "PRIMARY_POLICY"
    | "READ_AFTER_WRITE"
    | "FEATURE_DISABLED"
    | "DR_NOT_CONFIGURED"
    | "DR_UNHEALTHY"
    | "SNAPSHOT_MISSING"
    | "SNAPSHOT_STALE"
    | "REPLICATION_UNHEALTHY"
    | "SCHEMA_INCOMPATIBLE"
    | "LAG_UNKNOWN"
    | "LAG_EXCEEDED"
    | "DR_READY";
};

type DecideReadTargetInput = {
  policy: DatabaseReadPolicy;
  readAfterWrite: boolean;
  featureEnabled: boolean;
  drConfigured: boolean;
  drHealthStatus: string;
  snapshot: ReplicationReadinessSnapshot | null;
  maxLagSeconds: number;
  maxSnapshotAgeSeconds: number;
  now: Date;
};

export function decideReadTarget(input: DecideReadTargetInput): ReadTargetDecision {
  if (input.policy === "PRIMARY_ONLY") return { target: "PRIMARY", reason: "PRIMARY_POLICY" };
  if (input.readAfterWrite) return { target: "PRIMARY", reason: "READ_AFTER_WRITE" };
  if (!input.featureEnabled) return { target: "PRIMARY", reason: "FEATURE_DISABLED" };
  if (!input.drConfigured) return { target: "PRIMARY", reason: "DR_NOT_CONFIGURED" };
  if (input.drHealthStatus !== "HEALTHY") return { target: "PRIMARY", reason: "DR_UNHEALTHY" };
  if (!input.snapshot) return { target: "PRIMARY", reason: "SNAPSHOT_MISSING" };

  const snapshotAgeSeconds = Math.max(
    0,
    (input.now.getTime() - input.snapshot.observedAt.getTime()) / 1_000,
  );
  if (snapshotAgeSeconds > input.maxSnapshotAgeSeconds) {
    return { target: "PRIMARY", reason: "SNAPSHOT_STALE" };
  }
  if (input.snapshot.status !== "CONNECTED") {
    return { target: "PRIMARY", reason: "REPLICATION_UNHEALTHY" };
  }
  if (!input.snapshot.schemaCompatible) {
    return { target: "PRIMARY", reason: "SCHEMA_INCOMPATIBLE" };
  }
  if (input.snapshot.lagSeconds === null) {
    return { target: "PRIMARY", reason: "LAG_UNKNOWN" };
  }
  if (input.snapshot.lagSeconds > input.maxLagSeconds) {
    return { target: "PRIMARY", reason: "LAG_EXCEEDED" };
  }
  return { target: "DR", reason: "DR_READY" };
}

type ResolveReadDatabaseOptions = {
  policy: DatabaseReadPolicy;
  operation: string;
  maxLagSeconds?: number;
  maxSnapshotAgeSeconds?: number;
  readAfterWrite?: boolean;
};

export async function resolveReadDatabase({
  policy,
  operation,
  maxLagSeconds = 30,
  maxSnapshotAgeSeconds = 60,
  readAfterWrite = false,
}: ResolveReadDatabaseOptions): Promise<{
  client: PrismaClient;
  decision: ReadTargetDecision;
}> {
  if (policy === "PRIMARY_ONLY" || readAfterWrite) {
    const decision = decideReadTarget({
      policy,
      readAfterWrite,
      featureEnabled: false,
      drConfigured: false,
      drHealthStatus: "UNKNOWN",
      snapshot: null,
      maxLagSeconds,
      maxSnapshotAgeSeconds,
      now: new Date(),
    });
    return { client: prisma, decision };
  }

  const drConfigured = isDrDatabaseConfigured();
  const [flags, drHealth, snapshot] = await Promise.all([
    resolveResilienceFeatureFlags(["DR_READ_ROUTING_ENABLED"]),
    checkDrDatabaseHealth(),
    prisma.replicationHealthSnapshot.findFirst({
      where: { targetBackendCode: "DR" },
      orderBy: { observedAt: "desc" },
      select: {
        status: true,
        lagSeconds: true,
        schemaCompatible: true,
        observedAt: true,
      },
    }),
  ]);

  const decision = decideReadTarget({
    policy,
    readAfterWrite,
    featureEnabled: flags.DR_READ_ROUTING_ENABLED.enabled,
    drConfigured,
    drHealthStatus: drHealth.status,
    snapshot: snapshot
      ? {
          ...snapshot,
          lagSeconds: snapshot.lagSeconds === null ? null : Number(snapshot.lagSeconds),
        }
      : null,
    maxLagSeconds,
    maxSnapshotAgeSeconds,
    now: new Date(),
  });
  const dr = decision.target === "DR" ? getDrPrismaClient() : null;

  logEvent("info", "DATABASE_READ_ROUTED", {
    operation,
    policy,
    target: dr ? "DR" : "PRIMARY",
    reason: dr ? decision.reason : decision.target === "DR" ? "DR_NOT_CONFIGURED" : decision.reason,
  });

  return {
    client: dr ?? prisma,
    decision: dr
      ? decision
      : decision.target === "DR"
        ? { target: "PRIMARY", reason: "DR_NOT_CONFIGURED" }
        : decision,
  };
}

export async function withDatabaseRead<T>(
  options: ResolveReadDatabaseOptions,
  read: (client: PrismaClient) => Promise<T>,
) {
  const resolved = await resolveReadDatabase(options);
  try {
    return await read(resolved.client);
  } catch (error) {
    if (resolved.decision.target !== "DR") throw error;
    logEvent("warn", "DATABASE_DR_READ_FALLBACK", {
      operation: options.operation,
      reason: "DR_QUERY_FAILED",
    });
    return read(prisma);
  }
}
