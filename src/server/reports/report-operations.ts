import "server-only";
import { Prisma, type ReportDelivery } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AUTH_SESSION_ABSOLUTE_MAX_AGE_MS } from "@/lib/session-lifetime";
import { hasPermission } from "@/lib/rbac";
import { zonedCalendarDayUtcRange } from "@/lib/date-time";
import { canAccessReportSchedule, type ReportScheduleAccessScope } from "@/lib/report-schedule-access";
import { reportDeliveryQuerySchema, reportDeliverySummarySchema, reportIntentSchema, reportReconcileSchema, reportRetrySchema, ReportExecutionError } from "@/lib/report-delivery-contract";
import { assertCurrentReportEligibility } from "./report-execution";
import { reconcileReportProvider } from "./report-email";

export type ReportOperationAccess = ReportScheduleAccessScope & { organizationId: string; actorId: string; sessionId: string; deviceId: string | undefined; canManage: boolean; isPlatformAdmin: boolean; requestId: string };
async function assertCurrentAuthority(tx: Prisma.TransactionClient, access: ReportOperationAccess, row: ReportDelivery, reconcile = false) {
  await tx.$queryRaw`select id from public.profiles where id=${access.actorId}::uuid for share`;
  await tx.$queryRaw`select id from public.auth_sessions where id=${access.sessionId}::uuid for share`;
  await tx.$queryRaw`select id from public.organization_memberships where profile_id=${access.actorId}::uuid and organization_id=${access.organizationId}::uuid for share`;
  await tx.$queryRaw`select id from public.stall_memberships where profile_id=${access.actorId}::uuid and organization_id=${access.organizationId}::uuid for share`;
  const valid = await tx.$queryRaw<Array<{ id: string }>>`select s.id from public.auth_sessions s join public.profiles p on p.id=s.profile_id where s.id=${access.sessionId}::uuid and p.id=${access.actorId}::uuid and p.is_active and s.revoked_at is null and s.expires_at>clock_timestamp() and s.profile_session_version=p.session_version and s.device_id=${access.deviceId ?? null}::uuid and (select min(first.issued_at) from public.auth_sessions first where first.rotation_family_id=s.rotation_family_id)+${AUTH_SESSION_ABSOLUTE_MAX_AGE_MS}::bigint * interval '1 millisecond'>clock_timestamp()`;
  if (!valid.length) throw new ReportExecutionError("REPORT_SESSION_REVOKED", 403);
  const profile = await tx.profile.findUniqueOrThrow({ where: { id: access.actorId } });
  if (reconcile && profile.platformRole !== "PLATFORM_ADMIN") throw new ReportExecutionError("REPORT_RECONCILE_REQUIRED", 403);
  const intent = reportIntentSchema.parse(row.intentJson);
  await tx.$queryRaw`select id from public.stalls where id in (${Prisma.join(intent.stallIds.map(id => Prisma.sql`${id}::uuid`))}) for share`;
  const stalls = await tx.stall.findMany({ where: { id: { in: intent.stallIds }, organizationId: access.organizationId, isActive: true }, select: { id: true } });
  if (stalls.length !== intent.stallIds.length) throw new ReportExecutionError("REPORT_CURRENT_SCOPE_CHANGED", 403);
  if (profile.platformRole === "PLATFORM_ADMIN") return;
  const organizationRoles = await tx.organizationMembership.findMany({ where: { organizationId: access.organizationId, profileId: access.actorId, isActive: true } });
  const assignments = await tx.stallMembership.findMany({ where: { organizationId: access.organizationId, profileId: access.actorId, isActive: true } });
  const all = organizationRoles.some(member => member.role === "ORGANIZATION_OWNER" || member.allStalls);
  const permits = (role: Parameters<typeof hasPermission>[0]) => hasPermission(role, "VIEW_REPORTS") && hasPermission(role, "MANAGE_REPORT_SCHEDULES");
  if (!intent.stallIds.every(id => (organizationRoles.some(member => permits(member.role)) && (all || assignments.some(member => member.stallId === id))) || assignments.some(member => member.stallId === id && permits(member.role)))) throw new ReportExecutionError("REPORT_MANAGE_REQUIRED", 403);
}
function visible(row: ReportDelivery, access: ReportOperationAccess) {
  const intent = reportIntentSchema.safeParse(row.intentJson);
  return row.organizationId === access.organizationId && (intent.success ? canAccessReportSchedule(intent.data.stallIds, access) : access.canUseAllStalls);
}
function trustedRejection(row: ReportDelivery) {
  const evidence = row.reconciliationEvidence as Record<string, unknown> | null;
  const intent = reportIntentSchema.safeParse(row.intentJson);
  return intent.success && row.snapshotHash !== null && evidence?.kind === "REJECTED" && evidence.grantClosed === true && ["REPORT_ADAPTER", "PROVIDER_LOOKUP"].includes(String(evidence.source)) && evidence.binding === intent.data.binding && evidence.hash === row.snapshotHash;
}
export function reportSummary(row: ReportDelivery, access: ReportOperationAccess) {
  return reportDeliverySummarySchema.parse({
    id: row.id, version: row.executionVersion, status: row.status, effectState: row.effectState,
    attempt: row.attemptCount, maxAttempts: 5, reason: row.errorCode,
    createdAt: row.createdAt.toISOString(), startedAt: row.startedAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    acceptedAt: row.sentAt?.toISOString() ?? null, reconciledAt: row.reconciledAt?.toISOString() ?? null, requestId: row.originRequestId,
    canRetry: access.canManage && row.status === "FAILURE" && row.effectState === "REJECTED" && row.attemptCount < 5 && !row.leaseToken && trustedRejection(row),
    canReconcile: access.canManage && access.isPlatformAdmin && row.status === "FAILURE" && row.effectState === "UNKNOWN" && !row.leaseToken && !!row.snapshotHash && reportIntentSchema.safeParse(row.intentJson).success,
  });
}
async function getScoped(tx: Prisma.TransactionClient, access: ReportOperationAccess, id: string, lock = false) {
  z.uuid().parse(id);
  if (lock) await tx.$queryRaw`select id from public.report_deliveries where id=${id}::uuid and organization_id=${access.organizationId}::uuid for update`;
  const row = await tx.reportDelivery.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!row || !visible(row, access)) throw new ReportExecutionError("REPORT_NOT_FOUND", 404);
  return row;
}
export async function getReportDelivery(access: ReportOperationAccess, id: string) {
  return reportSummary(await getScoped(prisma, access, id), access);
}
export async function listReportDeliveries(access: ReportOperationAccess, input: unknown) {
  const query = reportDeliveryQuerySchema.parse(input);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { defaultTimezone: true } });
  const day = zonedCalendarDayUtcRange(new Date(), organization.defaultTimezone);
  const from = query.from ? new Date(query.from) : day.from, to = query.to ? new Date(query.to) : day.to;
  if (from >= to || to.getTime() - from.getTime() > 90 * 86400000) throw new ReportExecutionError("REPORT_DATE_RANGE_INVALID", 400);
  let cursor: ReportDelivery | undefined;
  if (query.cursor) {
    cursor = await getScoped(prisma, access, query.cursor);
    if (cursor.createdAt < from || cursor.createdAt >= to || (query.outcome === "UNKNOWN" && cursor.effectState !== "UNKNOWN") || (query.outcome === "FAILED" && cursor.status !== "FAILURE")) throw new ReportExecutionError("REPORT_CURSOR_INVALID", 400);
  }
  const scope = access.canUseAllStalls ? Prisma.sql`true` : Prisma.sql`d.intent_json is not null and d.intent_json->'stallIds' <@ ${JSON.stringify(access.authorizedStallIds)}::jsonb`;
  const outcome = query.outcome === "UNKNOWN" ? Prisma.sql`d.effect_state='UNKNOWN'` : query.outcome === "FAILED" ? Prisma.sql`d.status='FAILURE'` : Prisma.sql`true`;
  const after = cursor ? Prisma.sql`(d.created_at,d.id)<(select anchor.created_at,anchor.id from public.report_deliveries anchor where anchor.id=${cursor.id}::uuid and anchor.organization_id=${access.organizationId}::uuid)` : Prisma.sql`true`;
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`select d.id from public.report_deliveries d where d.organization_id=${access.organizationId}::uuid and d.created_at>=${from} and d.created_at<${to} and (${scope}) and (${outcome}) and (${after}) order by d.created_at desc,d.id desc limit ${query.limit + 1}`;
  const rows = await prisma.reportDelivery.findMany({ where: { id: { in: ids.slice(0, query.limit).map(row => row.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return { version: "v1" as const, items: rows.map(row => reportSummary(row, access)), nextCursor: ids.length > query.limit ? rows.at(-1)!.id : null, from: from.toISOString(), to: to.toISOString() };
}
async function audit(tx: Prisma.TransactionClient, access: ReportOperationAccess, action: string, before: ReportDelivery, after: ReportDelivery) {
  await tx.auditLog.create({ data: { organizationId: access.organizationId, actorProfileId: access.actorId, action, entityType: "REPORT_DELIVERY", entityId: before.id, requestId: access.requestId, outcome: "SUCCESS", beforeJson: { version: before.executionVersion, status: before.status, effectState: before.effectState, attempt: before.attemptCount }, afterJson: { version: after.executionVersion, status: after.status, effectState: after.effectState, attempt: after.attemptCount } } });
}
export async function retryReportDelivery(access: ReportOperationAccess, id: string, input: unknown) {
  const command = reportRetrySchema.parse(input);
  if (!access.canManage) throw new ReportExecutionError("REPORT_MANAGE_REQUIRED", 403);
  return prisma.$transaction(async tx => {
    const row = await getScoped(tx, access, id, true);
    if (row.executionVersion !== command.expectedVersion) throw new ReportExecutionError("REPORT_VERSION_STALE");
    if (!reportSummary(row, access).canRetry) throw new ReportExecutionError("REPORT_RETRY_UNSAFE");
    await assertCurrentAuthority(tx, access, row);
    await assertCurrentReportEligibility(tx, row);
    const updated = await tx.reportDelivery.update({ where: { id }, data: { status: "PROCESSING", nextAttemptAt: new Date(), executionVersion: { increment: 1 } } });
    await audit(tx, access, "REPORT_DELIVERY_RETRY_REQUESTED", row, updated);
    return reportSummary(updated, access);
  });
}
export async function reconcileReportDelivery(access: ReportOperationAccess, id: string, input: unknown) {
  const command = reportReconcileSchema.parse(input);
  if (!access.canManage || !access.isPlatformAdmin) throw new ReportExecutionError("REPORT_RECONCILE_REQUIRED", 403);
  // Do not hold a transaction open during provider lookup. The second read is version-fenced.
  const observed = await getScoped(prisma, access, id);
  if (observed.executionVersion !== command.expectedVersion) throw new ReportExecutionError("REPORT_VERSION_STALE");
  if (!reportSummary(observed, access).canReconcile) throw new ReportExecutionError("REPORT_RECONCILE_UNSAFE");
  const intent = reportIntentSchema.parse(observed.intentJson);
  const evidence = await reconcileReportProvider({ key: intent.key, hash: observed.snapshotHash!, binding: intent.binding });
  if (evidence.kind === "UNKNOWN") throw new ReportExecutionError("REPORT_RECONCILIATION_UNPROVEN");
  if (evidence.key !== intent.key || evidence.hash !== observed.snapshotHash || evidence.binding !== intent.binding || !evidence.reference || !Number.isFinite(Date.parse(evidence.checkedAt)) || (evidence.kind === "REJECTED" && !evidence.grantClosed)) throw new ReportExecutionError("REPORT_RECONCILIATION_UNPROVEN");
  return prisma.$transaction(async tx => {
    const row = await getScoped(tx, access, id, true);
    if (row.executionVersion !== command.expectedVersion || !reportSummary(row, access).canReconcile) throw new ReportExecutionError("REPORT_VERSION_STALE");
    await assertCurrentAuthority(tx, access, row, true);
    const accepted = evidence.kind !== "REJECTED";
    if (accepted && !evidence.messageId) throw new ReportExecutionError("REPORT_RECONCILIATION_UNPROVEN");
    const updated = await tx.reportDelivery.update({ where: { id }, data: { status: accepted ? evidence.kind === "SIMULATED" ? "SIMULATED" : "SENT" : "FAILURE", effectState: accepted ? "ACCEPTED" : "REJECTED", errorCode: accepted ? null : row.attemptCount >= 5 ? "WORKER_ATTEMPTS_EXHAUSTED" : "PROVIDER_CONFIRMED_REJECTION", providerMessageId: accepted ? evidence.messageId : null, sentAt: accepted ? new Date(evidence.checkedAt) : null, reconciledAt: new Date(), reconciledById: access.actorId, reconciliationEvidence: { version: 1, source: "PROVIDER_LOOKUP", ...evidence }, executionVersion: { increment: 1 } } });
    await audit(tx, access, "REPORT_DELIVERY_RECONCILED", row, updated);
    return reportSummary(updated, access);
  });
}
