import "server-only";

import { prisma } from "@/lib/prisma";

export type DrOperatorReadiness = {
  status: "READY" | "BLOCKED";
  checkedAt: string;
  runtime: {
    backendTarget: string;
    authProjectCode: string;
    promotionEpoch: number | null;
    supabaseProjectRef: string;
  };
  database: {
    backendCode: string | null;
    backendRole: string | null;
    promotionEpoch: number | null;
    writesEnabled: boolean | null;
    enforcementEnabled: boolean | null;
  };
  checks: {
    drRuntimeBinding: boolean;
    supabaseProjectBinding: boolean;
    epochAligned: boolean;
    readOnlyStandby: boolean;
    writerFence: boolean;
  };
};

type RuntimeState = {
  backendCode: string;
  backendRole: string;
  promotionEpoch: bigint | number;
  writesEnabled: boolean;
  enforcementEnabled: boolean;
} | null;

function parseEpoch(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function buildDrOperatorReadiness(
  environment: Record<string, string | undefined>,
  state: RuntimeState,
  now = new Date(),
): DrOperatorReadiness {
  const backendTarget = environment.BACKEND_ACTIVE_TARGET?.trim().toUpperCase() ?? "";
  const authProjectCode = environment.AUTH_PROJECT_CODE?.trim().toUpperCase() ?? "";
  const supabaseProjectRef = environment.DR_SUPABASE_PROJECT_REF?.trim() ?? "";
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/u, "") ?? "";
  const functionsUrl = environment.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL
    ?.trim()
    .replace(/\/$/u, "") ?? "";
  const runtimeEpoch = parseEpoch(environment.PROMOTION_EPOCH);
  const databaseEpoch = state ? Number(state.promotionEpoch) : null;
  const checks = {
    drRuntimeBinding: backendTarget === "DR"
      && authProjectCode === "DR"
      && state?.backendCode === "DR",
    supabaseProjectBinding: /^[a-z]{20}$/u.test(supabaseProjectRef)
      && supabaseUrl === `https://${supabaseProjectRef}.supabase.co`
      && functionsUrl === `https://${supabaseProjectRef}.supabase.co/functions/v1`,
    epochAligned: runtimeEpoch !== null
      && databaseEpoch !== null
      && runtimeEpoch === databaseEpoch,
    readOnlyStandby: state?.backendRole === "READ_ONLY_STANDBY"
      && state.writesEnabled === false,
    writerFence: state?.enforcementEnabled === true,
  };

  return {
    status: Object.values(checks).every(Boolean) ? "READY" : "BLOCKED",
    checkedAt: now.toISOString(),
    runtime: {
      backendTarget,
      authProjectCode,
      promotionEpoch: runtimeEpoch,
      supabaseProjectRef,
    },
    database: {
      backendCode: state?.backendCode ?? null,
      backendRole: state?.backendRole ?? null,
      promotionEpoch: databaseEpoch,
      writesEnabled: state?.writesEnabled ?? null,
      enforcementEnabled: state?.enforcementEnabled ?? null,
    },
    checks,
  };
}

export async function getDrOperatorReadiness() {
  const state = await prisma.backendRuntimeState.findFirst({
    where: { isCurrent: true },
    select: {
      backendCode: true,
      backendRole: true,
      promotionEpoch: true,
      writesEnabled: true,
      enforcementEnabled: true,
    },
  });
  return buildDrOperatorReadiness(process.env, state);
}
