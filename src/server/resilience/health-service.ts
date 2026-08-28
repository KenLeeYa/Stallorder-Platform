import "server-only";

import { performance } from "node:perf_hooks";
import { prisma } from "@/lib/prisma";
import { getAvailabilityConfig } from "@/server/resilience/availability-config-service";
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
const databaseProbeInFlight = new Map<string, Promise<unknown>>();

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

export function providerDependency(
  key: string,
  status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE" | "UNKNOWN",
): DependencyHealth {
  const mappedStatus: HealthStatus = status === "AVAILABLE" ? "HEALTHY" : status;
  return {
    key,
    status: mappedStatus,
    checkedAt: new Date().toISOString(),
    latencyMs: null,
    reasonCode: mappedStatus === "HEALTHY" ? null : `PROVIDER_${mappedStatus}`,
  };
}

export async function checkPrimaryDatabaseHealth() {
  return probeDatabase(
    "primaryDatabase",
    () => sharedDatabaseProbe("primaryDatabase", () => prisma.$queryRaw`SELECT 1`),
  );
}

export async function checkDrDatabaseHealth() {
  if (!isDrDatabaseConfigured()) {
    return unknownDependency("drDatabase", "NOT_CONFIGURED");
  }

  try {
    const client = getDrPrismaClient();
    if (!client) return unknownDependency("drDatabase", "NOT_CONFIGURED");
    return probeDatabase(
      "drDatabase",
      () => sharedDatabaseProbe("drDatabase", () => client.$queryRaw`SELECT 1`),
    );
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

function sharedDatabaseProbe(key: string, load: () => Promise<unknown>) {
  const existing = databaseProbeInFlight.get(key);
  if (existing) return existing;

  const pending = Promise.resolve().then(load);
  databaseProbeInFlight.set(key, pending);
  const clear = () => {
    if (databaseProbeInFlight.get(key) === pending) databaseProbeInFlight.delete(key);
  };
  void pending.then(clear, clear);
  return pending;
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
  const [primary, dr, replication, availability] = await Promise.all([
    checkPrimaryDatabaseHealth(),
    checkDrDatabaseHealth(),
    checkReplicationHealth(),
    getAvailabilityConfig("dependency-health"),
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
    providerDependency("linePay", availability.linePay),
    providerDependency("jkoPay", availability.jkoPay),
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
