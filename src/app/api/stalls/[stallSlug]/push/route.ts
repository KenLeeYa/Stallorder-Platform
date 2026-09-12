import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { encryptSubscription, pushConfig, pushHash, pushSubscriptionSchema } from "@/server/notifications/staff-push-crypto";

type Context = { params: Promise<{ stallSlug: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("SUBSCRIBE"), subscription: pushSubscriptionSchema }).strict(),
  z.object({ operation: z.literal("UNSUBSCRIBE") }).strict(),
  z.object({ operation: z.literal("TEST"), subscriptionId: z.uuid() }).strict(),
]);
export async function GET(request: Request, context: Context) {
  const { stallSlug } = await context.params;
  const auth = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!auth.ok) return auth.response;
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: auth.principal.sessionId } });
  const config = pushConfig();
  const subscriptions = config ? await prisma.staffPushSubscription.findMany({
    where: { stallId: auth.stall.id, profileId: auth.principal.user.id, sessionFamilyId: session.rotationFamilyId, enabled: true },
    select: { id: true, deliveries: { orderBy: { createdAt: "desc" }, take: 3,
      select: { id: true, status: true, availableAt: true, sentAt: true, displayedAt: true, errorCode: true } } },
  }) : [];
  return json({ configured: Boolean(config), publicKey: config?.publicKey ?? null, subscriptions });
}
export async function POST(request: Request, context: Context) {
  const { stallSlug } = await context.params;
  const auth = await authorizeApiRequest(request, stallSlug, "VIEW_ORDERS");
  if (!auth.ok) return auth.response;
  if (!validateCsrf(request, auth.principal)) return json({ error: "安全驗證已失效，請重新整理。" }, 403);
  const body = await readJson(request, auth.requestId);
  if (body.error) return body.error;
  const parsed = commandSchema.safeParse(body.data);
  if (!parsed.success) return json({ error: "推播訂閱格式不正確或此推播服務尚未支援。" }, 400);
  const command = parsed.data;
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: auth.principal.sessionId } });
  const owner = { profileId: auth.principal.user.id, sessionFamilyId: session.rotationFamilyId, stallId: auth.stall.id };
  if (command.operation === "UNSUBSCRIBE") {
    await prisma.staffPushSubscription.updateMany({ where: owner, data: { enabled: false } });
    return json({ ok: true });
  }
  const config = pushConfig();
  if (!config) return json({ error: "尚未設定 Web Push，請聯絡系統管理者。" }, 503);
  if (command.operation === "TEST") {
    const limit = await checkRateLimit({ scope: "staff-push-test", identifier: session.id, limit: 3, windowMs: 60_000 });
    if (!limit.allowed) return json({ error: "請稍候一分鐘再發送測試通知。" }, 429);
    const subscription = await prisma.staffPushSubscription.findFirst({ where: { ...owner, id: command.subscriptionId, enabled: true } });
    if (!subscription) return json({ error: "請先在這台裝置開啟鎖屏通知。" }, 404);
    const job = await prisma.staffPushDelivery.create({ data: {
      subscriptionId: subscription.id, availableAt: new Date(Date.now() + 30_000), expiresAt: new Date(Date.now() + 300_000),
    }, select: { id: true, availableAt: true } });
    return json({ job }, 202);
  }
  const hash = pushHash(command.subscription.endpoint);
  const limit = await checkRateLimit({ scope: "staff-push-subscribe", identifier: auth.principal.user.id, limit: 10, windowMs: 300_000 });
  if (!limit.allowed) return json({ error: "推播設定過於頻繁，請稍後重試。" }, 429);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))::text`;
    const existing = await tx.staffPushSubscription.findUnique({ where: { endpointHash: hash } });
    if (existing && (existing.profileId !== owner.profileId || existing.sessionFamilyId !== owner.sessionFamilyId || existing.stallId !== owner.stallId)) {
      return { error: "此裝置有舊的推播訂閱，請先關閉鎖屏通知，再重新開啟。" };
    }
    // Serialize the quota check for this account as well as ownership of the endpoint.
    await tx.$queryRaw`select id from public.profiles where id = ${owner.profileId}::uuid for update`;
    const count = await tx.staffPushSubscription.count({ where: { profileId: owner.profileId, enabled: true } });
    if (!existing?.enabled && count >= 10) return { error: "此帳號已啟用 10 個推播裝置，請先關閉不使用的裝置。" };
    const data = { ...owner, sessionVersion: session.profileSessionVersion,
      endpointHash: hash, encryptedSubscription: encryptSubscription(command.subscription, config.encryptionKey),
      vapidKeyHash: pushHash(config.publicKey), enabled: true };
    const subscription = await tx.staffPushSubscription.upsert({
      where: { endpointHash: hash }, create: data, update: data, select: { id: true },
    });
    return { subscription };
  });
  return json(result, "error" in result ? 409 : 200);
}
