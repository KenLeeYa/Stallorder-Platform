import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { SessionPrincipal } from "@/lib/auth";
import { findStallAccess } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { getWorkspaceAccess } from "@/lib/workspace";
import { productAnalytics } from "@/server/analytics/product-analytics";
import { inboxPreferenceCommandSchema, inboxPreferencesSchema, inboxQuerySchema, inboxRefSchema, inboxScopeSchema,
  type InboxItem, type InboxPreferences, type InboxQuery, type InboxRef, type InboxScope } from "@/lib/notification-inbox-contract";

export class InboxError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const missing = () => new InboxError(404, "INBOX_NOT_FOUND");
const defaults: InboxPreferences = { version: 1, billingVisible: true, applicationVisible: true, staffOrderVisible: true, analyticsConsent: false };
type Database = Prisma.TransactionClient;
type Access = { scope: InboxScope; profileId: string; source: InboxRef["source"]; stallId?: string };

async function currentPrincipal(principal: SessionPrincipal) {
  const row = await prisma.authSession.findFirst({ where: { id: principal.sessionId, profileId: principal.user.id, revokedAt: null, expiresAt: { gt: new Date() } }, include: { profile: true } });
  if (!row || !row.profile.isActive || row.profileSessionVersion !== row.profile.sessionVersion) throw new InboxError(401, "INBOX_SESSION_EXPIRED");
  return { ...principal, user: row.profile };
}
export async function authorizeInbox(principal: SessionPrincipal, input: InboxScope): Promise<Access> {
  const scope = inboxScopeSchema.parse(input);
  const current = await currentPrincipal(principal);
  const profileId = current.user.id;
  if (scope.kind === "PERSONAL") return { scope, profileId, source: "APPLICATION" };
  if (scope.kind === "ADMIN_APPLICATION") {
    if (current.user.platformRole !== "PLATFORM_ADMIN" || !await prisma.merchantApplication.findUnique({ where: { id: scope.applicationId }, select: { id: true } })) throw missing();
    return { scope, profileId, source: "APPLICATION" };
  }
  if (scope.kind === "ORGANIZATION") {
    const workspace = (await getWorkspaceAccess(profileId, current.user.platformRole)).find(row => row.id === scope.organizationId);
    if (!workspace || !workspace.roles.some(role => hasPermission(role, "VIEW_BILLING"))) throw missing();
    return { scope, profileId, source: "BILLING" };
  }
  const access = await findStallAccess(current, scope.stallSlug);
  if (!access?.roles.some(role => hasPermission(role, "VIEW_ORDERS"))) throw missing();
  return { scope, profileId, source: "STAFF_ORDER", stallId: access.stall.id };
}
async function preferences(db: Database, profileId: string) {
  const row = await db.notificationPreference.findUnique({ where: { profileId }, select: { version: true, billingVisible: true, applicationVisible: true, staffOrderVisible: true, analyticsConsent: true } });
  return inboxPreferencesSchema.parse(row ?? defaults);
}
const visible = (p: InboxPreferences, source: InboxRef["source"]) => source === "BILLING" ? p.billingVisible : source === "APPLICATION" ? p.applicationVisible : p.staffOrderVisible;
export async function getInboxPreferences(principal: SessionPrincipal) {
  const current = await currentPrincipal(principal);
  return preferences(prisma, current.user.id);
}
export async function setInboxPreferences(principal: SessionPrincipal, input: unknown, surface: 1 | 2 = 1) {
  const command = inboxPreferenceCommandSchema.parse(input);
  const current = await currentPrincipal(principal);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`select id from public.profiles where id=${current.user.id}::uuid for update`;
    const old = await preferences(tx, current.user.id);
    if (old.version !== command.version) throw new InboxError(409, "INBOX_PREFERENCE_CONFLICT");
    const { version, ...settings } = command;
    const row = await tx.notificationPreference.upsert({ where: { profileId: current.user.id },
      create: { profileId: current.user.id, ...settings, version: version + 1 }, update: { ...settings, version: { increment: 1 } } });
    const saved = inboxPreferencesSchema.parse({ version: row.version, billingVisible: row.billingVisible, applicationVisible: row.applicationVisible, staffOrderVisible: row.staffOrderVisible, analyticsConsent: row.analyticsConsent });
    const changed = ([["billingVisible", 1], ["applicationVisible", 2]] as const).filter(([field]) => saved[field] !== old[field]);
    return { preferences: saved, changed };
  });
  if (!result.preferences.analyticsConsent) productAnalytics.invalidate(current.user.id);
  else await Promise.all(result.changed.map(([field, category]) => productAnalytics.capture(current, {
    event: "notification_preference_changed", surface, category, enabled: result.preferences[field] ? 1 : 0,
  })));
  return result.preferences;
}

const cursorSchema = z.object({ version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), from: z.iso.datetime(), to: z.iso.datetime(), createdAt: z.iso.datetime(), id: z.uuid() }).strict();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function cursorSignature(payload: string) {
  const secret = process.env.TOKEN_DERIVATION_SECRET?.trim();
  if (!secret) throw new InboxError(503, "INBOX_CURSOR_UNAVAILABLE");
  return createHmac("sha256", secret).update("notification-inbox-cursor:v1:" + payload).digest("base64url");
}
function encodeCursor(value: z.infer<typeof cursorSchema>) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return payload + "." + cursorSignature(payload);
}
function windowFor(query: InboxQuery, profileId: string) {
  const now = new Date();
  const fingerprint = digest([profileId, query.scope, query.category ?? null, query.unreadOnly, query.from ?? null, query.to ?? null, query.limit]);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (query.cursor) {
    const [payload, signature, extra] = query.cursor.split(".");
    const expected = Buffer.from(cursorSignature(payload));
    const actual = Buffer.from(signature ?? "");
    if (extra !== undefined || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new InboxError(400, "INBOX_CURSOR_INVALID");
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); } catch { throw new InboxError(400, "INBOX_CURSOR_INVALID"); }
    if (cursor.fingerprint !== fingerprint) throw new InboxError(400, "INBOX_CURSOR_INVALID");
  }
  const to = new Date(cursor?.to ?? query.to ?? now.toISOString());
  const from = new Date(cursor?.from ?? query.from ?? new Date(to.getTime() - 30 * 86400000).toISOString());
  if (from >= to || to.getTime() - from.getTime() > 90 * 86400000 || to.getTime() > now.getTime() + 1000
    || (query.from && from.getTime() !== new Date(query.from).getTime()) || (query.to && to.getTime() !== new Date(query.to).getTime())
    || (cursor && (new Date(cursor.createdAt) < from || new Date(cursor.createdAt) >= to))) throw new InboxError(400, "INBOX_DATE_RANGE_INVALID");
  return { from, to, cursor, fingerprint };
}
type Selection = { from?: Date; to?: Date; after?: { createdAt: string; id: string } | null; unreadOnly?: boolean; id?: string };
function commonWhere(selection: Selection) {
  return {
    ...(selection.id ? { id: selection.id } : {}),
    ...(selection.from && selection.to ? { createdAt: { gte: selection.from, lt: selection.to } } : {}),
  };
}
function sourceWhere(access: Access, selection: Selection) {
  const ownUnread = selection.unreadOnly ? { none: { profileId: access.profileId } } : undefined;
  const common = commonWhere(selection);
  if (access.scope.kind === "ORGANIZATION") return { source: "BILLING" as const, where: { ...common, organizationId: access.scope.organizationId, dismissedAt: null, personalReadReceipts: ownUnread } };
  if (access.scope.kind === "STALL") return { source: "STAFF_ORDER" as const, where: { ...common, stallId: access.stallId, pushDeliveries: { some: { subscription: { profileId: access.profileId, stallId: access.stallId } } }, notificationReadReceipts: ownUnread } };
  return { source: "APPLICATION" as const, where: { ...common, ...(access.scope.kind === "PERSONAL" ? { profileId: access.profileId } : { applicationId: access.scope.applicationId }), personalReadReceipts: ownUnread } };
}
async function countSources(db: Database, access: Access, selection: Selection) {
  const source = sourceWhere(access, selection);
  if (source.source === "BILLING") return db.billingNotification.count({ where: source.where });
  if (source.source === "STAFF_ORDER") return db.order.count({ where: source.where });
  return db.merchantApplicationNotification.count({ where: source.where });
}
async function selectSources(db: Database, access: Access, selection: Selection, take: number): Promise<InboxItem[]> {
  const source = sourceWhere(access, selection);
  // Resolve the authorized anchor in this transaction; Prisma compares the database's
  // full timestamp precision instead of the millisecond display value in the DTO.
  if (selection.after && !await countSources(db, access, { ...selection, after: null, id: selection.after.id })) throw new InboxError(400, "INBOX_CURSOR_INVALID");
  const page: { cursor?: { id: string }; skip?: number } = selection.after ? { cursor: { id: selection.after.id }, skip: 1 } : {};
  const receipts = { where: { profileId: access.profileId }, select: { readAt: true }, take: 1 };
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  if (source.source === "BILLING") {
    const rows = await db.billingNotification.findMany({ where: source.where, ...page, take, orderBy, select: { id: true, title: true, message: true, createdAt: true, organizationId: true, personalReadReceipts: receipts } });
    return rows.map(row => ({ source: "BILLING", category: "BILLING", id: row.id, title: row.title, message: row.message, createdAt: row.createdAt.toISOString(), readAt: row.personalReadReceipts[0]?.readAt.toISOString() ?? null, target: { kind: "BILLING_HOME", organizationId: row.organizationId } }));
  }
  if (source.source === "STAFF_ORDER") {
    const rows = await db.order.findMany({ where: source.where, ...page, take, orderBy, select: { id: true, createdAt: true, stall: { select: { slug: true } }, notificationReadReceipts: receipts } });
    return rows.map(row => ({ source: "STAFF_ORDER", category: "STAFF_ORDER", id: row.id, title: "StallOrder · 新訂單", message: "有新的訂單，請開啟店員看板查看。", createdAt: row.createdAt.toISOString(), readAt: row.notificationReadReceipts[0]?.readAt.toISOString() ?? null, target: { kind: "STAFF_BOARD", stallSlug: row.stall.slug } }));
  }
  const rows = await db.merchantApplicationNotification.findMany({ where: source.where, ...page, take, orderBy, select: { id: true, title: true, message: true, createdAt: true, applicationId: true, personalReadReceipts: receipts } });
  return rows.map(row => ({ source: "APPLICATION", category: "APPLICATION", id: row.id, title: row.title, message: row.message, createdAt: row.createdAt.toISOString(), readAt: row.personalReadReceipts[0]?.readAt.toISOString() ?? null, target: access.scope.kind === "ADMIN_APPLICATION" ? { kind: "ADMIN_APPLICATION", applicationId: row.applicationId } : { kind: "APPLICATION_STATUS" } }));
}
export async function listInbox(principal: SessionPrincipal, input: unknown) {
  const query = inboxQuerySchema.parse(input);
  const access = await authorizeInbox(principal, query.scope);
  const window = windowFor(query, access.profileId);
  return prisma.$transaction(async tx => {
    const prefs = await preferences(tx, access.profileId);
    const enabled = visible(prefs, access.source) && (!query.category || query.category === access.source);
    const rows = enabled ? await selectSources(tx, access, { ...window, after: window.cursor, unreadOnly: query.unreadOnly }, query.limit + 1) : [];
    const unreadCount = enabled ? await countSources(tx, access, { from: window.from, to: window.to, unreadOnly: true }) : 0;
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor({ version: 1, fingerprint: window.fingerprint, from: window.from.toISOString(), to: window.to.toISOString(), createdAt: last.createdAt, id: last.id }) : null;
    return { version: "v1" as const, items, unreadCount, nextCursor, from: window.from.toISOString(), to: window.to.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getInboxItem(principal: SessionPrincipal, scope: InboxScope, input: InboxRef) {
  const ref = inboxRefSchema.parse(input);
  const access = await authorizeInbox(principal, scope);
  if (ref.source !== access.source || !visible(await preferences(prisma, access.profileId), ref.source)) throw missing();
  const [item] = await selectSources(prisma, access, { id: ref.id }, 1);
  if (!item) throw missing();
  return item;
}
export async function markInboxRead(principal: SessionPrincipal, scope: InboxScope, input: InboxRef) {
  const ref = inboxRefSchema.parse(input);
  const access = await authorizeInbox(principal, scope);
  if (ref.source !== access.source) throw missing();
  return prisma.$transaction(async tx => {
    if (!visible(await preferences(tx, access.profileId), ref.source) || !(await selectSources(tx, access, { id: ref.id }, 1)).length) throw missing();
    let receipt;
    if (ref.source === "BILLING") receipt = await tx.notificationReadReceipt.upsert({ where: { profileId_billingNotificationId: { profileId: access.profileId, billingNotificationId: ref.id } }, create: { profileId: access.profileId, billingNotificationId: ref.id }, update: {} });
    else if (ref.source === "APPLICATION") {
      receipt = await tx.notificationReadReceipt.upsert({ where: { profileId_applicationNotificationId: { profileId: access.profileId, applicationNotificationId: ref.id } }, create: { profileId: access.profileId, applicationNotificationId: ref.id }, update: {} });
      await tx.merchantApplicationNotification.updateMany({ where: { id: ref.id, profileId: access.profileId, readAt: null }, data: { readAt: receipt.readAt } });
    } else {
      const delivery = await tx.staffPushDelivery.findFirst({ where: { orderId: ref.id, subscription: { profileId: access.profileId, stallId: access.stallId }, order: { stallId: access.stallId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
      if (!delivery) throw missing();
      receipt = await tx.notificationReadReceipt.upsert({ where: { profileId_staffOrderId: { profileId: access.profileId, staffOrderId: ref.id } }, create: { profileId: access.profileId, staffOrderId: ref.id, staffDeliveryId: delivery.id }, update: {} });
    }
    return { readAt: receipt.readAt.toISOString() };
  });
}
