import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type ReportDelivery, type ReportSchedule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reportIntentSchema, ReportExecutionError, type ReportIntent } from "@/lib/report-delivery-contract";
import { EntitlementService } from "@/server/billing/entitlement-service";
import { reportProviderBinding } from "./report-email";

export type ReportClaim = { id: string; token: string; version: number };
export function reportScheduleFingerprint(schedule: ReportSchedule) {
  return createHash("sha256").update(JSON.stringify([schedule.organizationId, schedule.name, schedule.reportType, [...schedule.recipients], [...schedule.stallIds].sort(), schedule.timezone, schedule.sendHour, schedule.sendMinute, schedule.dayOfWeek, schedule.isEnabled, schedule.archivedAt])).digest("hex");
}
export function createReportIntent(schedule: ReportSchedule, id: string): ReportIntent {
  const provider = reportProviderBinding();
  return reportIntentSchema.parse({ version: 1, stallIds: [...schedule.stallIds].sort(), scheduleFingerprint: reportScheduleFingerprint(schedule), binding: provider.binding, mode: provider.mode, key: `stallorder-report-${id}` });
}
export async function recoverReportDeliveries() {
  return prisma.$queryRaw<Array<{ count: number }>>`select app_private.recover_report_deliveries() as count`;
}
export async function claimReportDeliveries(limit = 20, deliveryId: string | null = null): Promise<ReportClaim[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ReportExecutionError("REPORT_BATCH_LIMIT_INVALID", 400);
  try {
    return await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string; lease_token: string; execution_version: number }>>`select id,lease_token,execution_version from app_private.claim_report_deliveries(${limit}::integer,${deliveryId}::uuid)`;
      return rows.map(row => ({ id: row.id, token: row.lease_token, version: row.execution_version }));
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "P4B01" && error.meta.message === "ERROR: REPORT_ONE_ORG_CONFLICT") {
      // The failed transaction has rolled back every claim; read committed state before yielding.
      await prisma.reportDelivery.findMany({ where: deliveryId ? { id: deliveryId } : { status: "PROCESSING", leaseToken: { not: null } }, select: { id: true, executionVersion: true }, take: 20 });
      return [];
    }
    throw error;
  }
}
export async function lockReportClaim(tx: Prisma.TransactionClient, claim: ReportClaim) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`select id from public.report_deliveries where id=${claim.id}::uuid and lease_token=${claim.token}::uuid and execution_version=${claim.version} and lease_expires_at>clock_timestamp() and status='PROCESSING' for update`;
  if (rows.length !== 1) throw new ReportExecutionError("REPORT_LEASE_STALE");
  return tx.reportDelivery.findUniqueOrThrow({ where: { id: claim.id } });
}
export async function assertCurrentReportEligibility(tx: Prisma.TransactionClient, delivery: ReportDelivery) {
  const intent = reportIntentSchema.parse(delivery.intentJson);
  // Share locks serialize current revocation/config changes with the short pre-effect CAS.
  await tx.$queryRaw`select id from public.organizations where id=${delivery.organizationId}::uuid for share`;
  await tx.$queryRaw`select id from public.report_schedules where id=${delivery.reportScheduleId}::uuid for share`;
  await tx.$queryRaw`select id from public.stalls where id in (${Prisma.join(intent.stallIds.map(id=>Prisma.sql`${id}::uuid`))}) for share`;
  await tx.$queryRaw`select id from public.subscriptions where organization_id=${delivery.organizationId}::uuid for share`;
  const flags = await tx.$queryRaw<Array<{ code: string }>>`select code from public.billing_feature_flags where code='OPEN_BETA_FREE_ACCESS_ENABLED' for share`;
  if (flags.length === 0) {
    // Preserve the central missing-flag default while fencing a concurrent insert.
    await tx.$executeRaw`lock table public.billing_feature_flags in share mode`;
    await tx.$queryRaw`select code from public.billing_feature_flags where code='OPEN_BETA_FREE_ACCESS_ENABLED' for share`;
  }
  await tx.$queryRaw`select pe.id from public.plan_entitlements pe join public.subscriptions s on s.plan_version_id=pe.plan_version_id where s.organization_id=${delivery.organizationId}::uuid and pe.feature_code='SCHEDULED_REPORTS' order by pe.id for share of pe`;
  const items = await tx.$queryRaw<Array<{ code: string }>>`select si.code from public.subscription_items si join public.subscriptions s on s.id=si.subscription_id where s.organization_id=${delivery.organizationId}::uuid and si.item_type='ADD_ON' order by si.id for share of si`;
  if (items.length > 0) {
    await tx.$queryRaw`select id from public.add_on_catalog where code in (${Prisma.join(items.map(item => item.code))}) and feature_code='SCHEDULED_REPORTS' order by id for share`;
  }
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: delivery.organizationId } });
  const schedule = await tx.reportSchedule.findUniqueOrThrow({ where: { id: delivery.reportScheduleId } });
  const stalls = await tx.stall.count({ where: { id: { in: intent.stallIds }, organizationId: delivery.organizationId, isActive: true } });
  if (["SUSPENDED", "CANCELLED"].includes(organization.status) || !schedule.isEnabled || schedule.archivedAt || schedule.organizationId !== delivery.organizationId || stalls !== intent.stallIds.length || reportScheduleFingerprint(schedule) !== intent.scheduleFingerprint || reportProviderBinding().binding !== intent.binding) throw new ReportExecutionError("REPORT_CURRENT_SCOPE_CHANGED", 403);
  await new EntitlementService(tx).assertFeatureEnabled(delivery.organizationId, "SCHEDULED_REPORTS");
  return intent;
}
export async function authorizeReportEffect(claim: ReportClaim, hash: string) {
  return prisma.$transaction(async tx => {
    const delivery = await lockReportClaim(tx, claim);
    await assertCurrentReportEligibility(tx, delivery);
    const rows = await tx.$queryRaw<Array<{ execution_version: number }>>`select execution_version from app_private.authorize_report_effect(${claim.id}::uuid,${claim.token}::uuid,${claim.version}::integer,${hash})`;
    if (rows.length !== 1) throw new ReportExecutionError("REPORT_LEASE_STALE");
    return { ...claim, version: rows[0].execution_version };
  // Re-read committed authority after locks, including the missing-flag insert fence.
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
