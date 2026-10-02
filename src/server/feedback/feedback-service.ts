import "server-only";
import { Prisma } from "@prisma/client";
import type { SessionPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { feedbackCommandSchema, feedbackItemSchema, feedbackQuerySchema, feedbackReceiptSchema, feedbackUpdateSchema } from "@/lib/feedback-contract";
import { productAnalytics } from "@/server/analytics/product-analytics";
export class FeedbackError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}
const missing = () => new FeedbackError(404, "FEEDBACK_NOT_FOUND");
const select = { id: true, organizationId: true, kind: true, surface: true, message: true, requestId: true, status: true, version: true, createdAt: true, updatedAt: true, expiresAt: true } satisfies Prisma.ProductFeedbackSelect;
type Row = Prisma.ProductFeedbackGetPayload<{
    select: typeof select;
}>;
const item = (row: Row) => feedbackItemSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), expiresAt: row.expiresAt.toISOString() });
export async function requireFeedbackOrganization(principal: SessionPrincipal, organizationId: string | null) {
    if (!organizationId)
        return;
    const where = { organizationId, profileId: principal.user.id, isActive: true };
    const [organization, stall] = await Promise.all([prisma.organizationMembership.findFirst({ where, select: { id: true } }), prisma.stallMembership.findFirst({ where, select: { id: true } })]);
    if (!organization && !stall)
        throw missing();
}
export async function submitFeedback(principal: SessionPrincipal, input: unknown) {
    const command = feedbackCommandSchema.parse(input);
    await requireFeedbackOrganization(principal, command.organizationId);
    if (command.requestId && !await prisma.auditLog.findFirst({ where: { requestId: command.requestId, actorProfileId: principal.user.id, organizationId: command.organizationId, outcome: "FAILURE", createdAt: { gte: new Date(Date.now() - 86400000) } }, select: { id: true } }))
        throw new FeedbackError(400, "FEEDBACK_REFERENCE_INVALID");
    const row = await prisma.productFeedback.create({ data: { ...command, profileId: principal.user.id, surface: principal.user.platformRole === "PLATFORM_ADMIN" ? "ADMIN" : "MERCHANT" }, select: { id: true, status: true, version: true, createdAt: true } });
    // Only server-owned enums after the durable create, never message/scope/request IDs.
    await productAnalytics.capture(principal, { event: "feedback_submitted", surface: 1, kind: command.kind === "ISSUE" ? 1 : 2, outcome: 1 });
    return feedbackReceiptSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
}
function admin(principal: SessionPrincipal) { if (principal.user.platformRole !== "PLATFORM_ADMIN")
    throw missing(); }
function selection(input: unknown) {
    const query = feedbackQuerySchema.parse(input);
    const where = { expiresAt: { gt: new Date() }, createdAt: { gte: new Date(query.from), lt: new Date(query.to) }, ...(query.organizationId ? { organizationId: query.organizationId } : {}), ...(query.status ? { status: query.status } : {}) } satisfies Prisma.ProductFeedbackWhereInput;
    return { query, where };
}
export async function listFeedback(principal: SessionPrincipal, input: unknown) {
    admin(principal);
    const { query, where } = selection(input);
    return prisma.$transaction(async (tx) => {
        if (query.cursor && !await tx.productFeedback.findFirst({ where: { ...where, id: query.cursor }, select: { id: true } }))
            throw new FeedbackError(400, "FEEDBACK_CURSOR_INVALID");
        const rows = await tx.productFeedback.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
        const items = rows.slice(0, query.limit).map(item);
        return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null, from: query.from, to: query.to };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function getFeedback(principal: SessionPrincipal, id: string, input: unknown) {
    admin(principal);
    const { where } = selection(input);
    const row = await prisma.productFeedback.findFirst({ where: { ...where, id }, select });
    if (!row)
        throw missing();
    return item(row);
}
export async function updateFeedback(principal: SessionPrincipal, id: string, input: unknown, filter: unknown) {
    admin(principal);
    const command = feedbackUpdateSchema.parse(input), { where } = selection(filter);
    return prisma.$transaction(async (tx) => {
        const row = await tx.productFeedback.findFirst({ where: { ...where, id }, select: { id: true } });
        if (!row)
            throw missing();
        const updated = await tx.productFeedback.updateMany({ where: { ...where, id, version: command.expectedVersion }, data: { status: command.status, version: { increment: 1 } } });
        if (updated.count !== 1)
            throw new FeedbackError(409, "FEEDBACK_VERSION_CONFLICT");
        const result = await tx.productFeedback.findUniqueOrThrow({ where: { id }, select });
        return item(result);
    });
}
// Runs after the existing dispatch cycle, in its own bounded transaction. No new scheduler.
export async function cleanupExpiredFeedback() {
    try {
        return await prisma.$transaction(async (tx) => {
            await tx.$executeRaw `set local statement_timeout = '1000ms'`;
            await tx.$executeRaw `set local lock_timeout = '250ms'`;
            return tx.$executeRaw `delete from public.product_feedback where id in (select id from public.product_feedback where expires_at <= now() order by expires_at,id limit 500 for update skip locked)`;
        }, { timeout: 1500, maxWait: 500 });
    }
    catch {
        return null;
    }
}
