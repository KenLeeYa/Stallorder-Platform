import "server-only";
import { randomUUID } from "node:crypto";
import webPush from "web-push";
import { prisma } from "@/lib/prisma";
import { findStallAccess } from "@/lib/authorization";
import { hasPermission } from "@/lib/rbac";
import { decryptSubscription, pushConfig, pushHash, pushReceiptToken } from "./staff-push-crypto";

export async function processStaffPushJobs(now = new Date()) {
  const config = pushConfig();
  if (!config) return { configured: false, results: [] };
  await prisma.staffPushDelivery.updateMany({
    where: { status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { lte: now } },
    data: { status: "CANCELLED", errorCode: "DELIVERY_EXPIRED" },
  });
  await prisma.staffPushDelivery.updateMany({
    where: { status: "PROCESSING", claimedAt: { lt: new Date(now.getTime() - 120_000) } },
    data: { status: "PENDING", leaseToken: null },
  });
  await prisma.staffPushDelivery.updateMany({
    where: { status: "PENDING", attempts: { gte: 4 } },
    data: { status: "FAILED", errorCode: "RETRY_LIMIT" },
  });
  const lease = randomUUID();
  const jobs = await prisma.$queryRaw<Array<{ id: string }>>`
    update public.staff_push_deliveries set status = 'PROCESSING', lease_token = ${lease}::uuid,
      attempts = attempts + 1, claimed_at = ${now}
    where id in (select id from public.staff_push_deliveries
      where status = 'PENDING' and available_at <= ${now} and expires_at > ${now}
        and attempts < 4 order by available_at limit 10 for update skip locked)
    returning id
  `;
  const results = await Promise.all(jobs.map(async ({ id }) => {
    const job = await prisma.staffPushDelivery.findUniqueOrThrow({
      where: { id }, include: { subscription: { include: { stall: true } }, order: { select: { status: true } } },
    });
    const subscription = job.subscription;
    const finish = async (status: string, errorCode: string | null = null, extra = {}) => {
      await prisma.staffPushDelivery.updateMany({
        where: { id, leaseToken: lease, status: "PROCESSING" },
        data: { status, errorCode, ...extra },
      });
      return { id, status, errorCode };
    };
    try {
      const session = await prisma.authSession.findFirst({
        where: {
          rotationFamilyId: subscription.sessionFamilyId, profileId: subscription.profileId,
          revokedAt: null, expiresAt: { gt: now }, profileSessionVersion: subscription.sessionVersion,
          profile: { isActive: true, sessionVersion: subscription.sessionVersion },
        },
        include: { profile: true },
      });
      const access = session ? await findStallAccess({
        sessionId: session.id, sessionExpiresAt: session.expiresAt, csrfTokenHash: session.csrfTokenHash,
        user: session.profile,
      }, subscription.stall.slug) : null;
      if (!subscription.enabled || !access?.roles.some(role => hasPermission(role, "VIEW_ORDERS"))
        || subscription.vapidKeyHash !== pushHash(config.publicKey)) {
        await prisma.staffPushSubscription.update({ where: { id: subscription.id }, data: { enabled: false } });
        return finish("CANCELLED", "SUBSCRIPTION_INACTIVE");
      }
      if (job.order && ["CANCELLED", "EXPIRED", "COMPLETED"].includes(job.order.status)) {
        return finish("CANCELLED", "ORDER_NO_LONGER_ACTIVE");
      }
      const payload = {
        type: "STAFF_NEW_ORDER", deliveryId: id,
        title: job.orderId ? "StallOrder · 新訂單" : "StallOrder · 鎖屏測試",
        body: job.orderId ? "有新的訂單，請開啟店員看板查看。" : "已收到 Web Push。請確認鎖屏顯示及提示音。",
        url: "/staff/" + encodeURIComponent(subscription.stall.slug),
        tag: "staff-order-" + (job.orderId ?? id),
        receiptToken: pushReceiptToken(id, config.encryptionKey),
      };
      await webPush.sendNotification(decryptSubscription(subscription.encryptedSubscription, config.encryptionKey),
        JSON.stringify(payload), {
          vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
          TTL: Math.max(1, Math.floor((job.expiresAt.getTime() - now.getTime()) / 1000)),
          urgency: "high", topic: pushHash(payload.tag).slice(0, 32), timeout: 8000,
        });
      return finish("SENT", null, { sentAt: new Date() });
    } catch (error) {
      const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (status === 404 || status === 410) {
        await prisma.staffPushSubscription.update({ where: { id: subscription.id }, data: { enabled: false } });
        return finish("CANCELLED", "SUBSCRIPTION_GONE");
      }
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      const retryAt = new Date(Date.now() + Math.min(60_000, 15_000 * 2 ** (job.attempts - 1)));
      return retryable && job.attempts < 4 && retryAt < job.expiresAt
        ? finish("PENDING", status ? "PUSH_HTTP_" + status : "PUSH_DELIVERY_FAILED", { availableAt: retryAt })
        : finish("FAILED", status ? "PUSH_HTTP_" + status : "PUSH_DELIVERY_FAILED");
    }
  }));
  return { configured: true, results };
}
