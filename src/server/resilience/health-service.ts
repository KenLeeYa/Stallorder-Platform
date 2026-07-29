import "server-only";

import { performance } from "node:perf_hooks";
import { prisma } from "@/lib/prisma";
import { getDrPrismaClient, isDrDatabaseConfigured } from "@/server/resilience/database-targets";

export const healthStatuses = [
  "HEALTHY",
  "DEGRADED",
  "UNAVAILABLE",
  "MAINTENANCE",
  "UNKNOWN",
] as const;

export type HealthStatus = (typeof healthStatuses)[number];

export type DependencyHealth = {
  key: string;
  status: HealthStatus;
  checkedAt: string;
  latencyMs: number | null;
  reasonCode: string | null;
};

const DATABASE_DEGRADED_AFTER_MS = 800;
const DATABASE_TIMEOUT_MS = 2_500;

function roundDuration(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

export function classifyDatabaseLatency(
  latencyMs: number,
  degradedAfterMs = DATABASE_DEGRADED_AFTER_MS,
): HealthStatus {
  return latencyMs > degradedAfterMs ? "DEGRADED" : "HEALTHY";
}

export async function probeDatabase(
  key: string,
  probe: () => Promise<unknown>,
  options: {
    degradedAfterMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<DependencyHealth> {
  const checkedAt = new Date().toISOString();
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? DATABASE_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      probe(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("HEALTH_PROBE_TIMEOUT")), timeoutMs);
      }),
    ]);
    const latencyMs = roundDuration(performance.now() - startedAt);
    return {
      key,
      status: classifyDatabaseLatency(
        latencyMs,
        options.degradedAfterMs ?? DATABASE_DEGRADED_AFTER_MS,
      ),
      checkedAt,
      latencyMs,
      reasonCode: null,
    };
  } catch (error) {
    return {
      key,
      status: "UNAVAILABLE",
      checkedAt,
      latencyMs: roundDuration(performance.now() - startedAt),
      reasonCode: error instanceof Error && error.message === "HEALTH_PROBE_TIMEOUT"
        ? "PROBE_TIMEOUT"
        : "PROBE_FAILED",
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function unknownDependency(key: string, reasonCode = "PROBE_NOT_IMPLEMENTED"): DependencyHealth {
  return {
    key,
    status: "UNKNOWN",
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    reasonCode,
  };
}

export async function checkPrimaryDatabaseHealth() {
  return probeDatabase(
    "primaryDatabase",
    () => prisma.$queryRaw`SELECT 1`,
  );
}

export async function checkDrDatabaseHealth() {
  if (!isDrDatabaseConfigured()) {
    return unknownDependency("drDatabase", "NOT_CONFIGURED");
  }

  try {
    const client = getDrPrismaClient();
    if (!client) return unknownDependency("drDatabase", "NOT_CONFIGURED");
    return probeDatabase("drDatabase", () => client.$queryRaw`SELECT 1`);
  } catch {
    return {
      key: "drDatabase",
      status: "UNAVAILABLE" as const,
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      reasonCode: "INVALID_CONFIGURATION",
    };
  }
}

export async function checkReplicationHealth(): Promise<DependencyHealth> {
  if (!isDrDatabaseConfigured()) {
    return unknownDependency("replication", "DR_NOT_CONFIGURED");
  }

  try {
    const snapshot = await prisma.replicationHealthSnapshot.findFirst({
      where: { targetBackendCode: "DR" },
      orderBy: { observedAt: "desc" },
      select: {
        status: true,
        lagSeconds: true,
        schemaCompatible: true,
        observedAt: true,
      },
    });
    if (!snapshot) return unknownDependency("replication", "NO_OBSERVATION");
    if (Date.now() - snapshot.observedAt.getTime() > 60_000) {
      return {
        key: "replication",
        status: "UNAVAILABLE",
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        reasonCode: "OBSERVATION_STALE",
      };
    }
    const lagSeconds = snapshot.lagSeconds === null ? null : Number(snapshot.lagSeconds);
    const healthy = snapshot.status === "CONNECTED"
      && snapshot.schemaCompatible
      && lagSeconds !== null
      && lagSeconds <= 30;
    return {
      key: "replication",
      status: healthy ? "HEALTHY" : "DEGRADED",
      checkedAt: snapshot.observedAt.toISOString(),
      latencyMs: lagSeconds === null ? null : roundDuration(lagSeconds * 1_000),
      reasonCode: healthy ? null : "REPLICATION_NOT_READY",
    };
  } catch {
    return unknownDependency("replication", "OBSERVATION_UNAVAILABLE");
  }
}

export function summarizeCoreHealth(
  primary: DependencyHealth,
  dr: DependencyHealth,
): HealthStatus {
  if (primary.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (primary.status === "DEGRADED") return "DEGRADED";
  if (dr.status === "UNAVAILABLE" || dr.status === "DEGRADED") return "DEGRADED";
  return "HEALTHY";
}

export async function getDependencyHealthSnapshot() {
  const [primary, dr, replication] = await Promise.all([
    checkPrimaryDatabaseHealth(),
    checkDrDatabaseHealth(),
    checkReplicationHealth(),
  ]);
  const checkedAt = new Date().toISOString();
  const dependencies: DependencyHealth[] = [
    {
      key: "application",
      status: "HEALTHY",
      checkedAt,
      latencyMs: null,
      reasonCode: null,
    },
    primary,
    dr,
    replication,
    unknownDependency("primaryEdge"),
    unknownDependency("drEdge"),
    unknownDependency("realtime"),
    unknownDependency("sse"),
    unknownDependency("storageMirror"),
    unknownDependency("turnstile", "EDGE_MANAGED"),
    unknownDependency("linePay", "NOT_ENABLED"),
    unknownDependency("jkoPay", "NOT_ENABLED"),
    unknownDependency(
      "reportDelivery",
      process.env.REPORT_DELIVERY_MODE === "simulate" ? "SIMULATION_MODE" : "PROBE_NOT_IMPLEMENTED",
    ),
  ];

  return {
    status: summarizeCoreHealth(primary, dr),
    checkedAt,
    dependencies,
  };
}
