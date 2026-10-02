import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lineIntegrationSecretsSchema, lineIntegrationSettingsSchema } from "@/lib/line-notification-contract";
import type { LineWebhookManagementCommand } from "@/lib/line-webhook-management-contract";
import { getLegacyLineMockTransport } from "./line-messaging-provider";
import { readNotificationSecret } from "./notification-secrets";

type Binding = { id: string; organization_id: string; stall_id: string; stall_name: string; status: string;
  environment: string | null; provider_id: string | null; oa_destination: string | null;
  secret_reference: string | null; settings_json: Prisma.JsonValue };
type Database = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const remoteSchema = z.object({ endpoint: z.string().max(500), active: z.literal(false), revision: z.string().min(1).max(100),
  providerId: z.string(), messagingChannelId: z.string(), destination: z.string() }).strict();
const providerEndpoint = "https://api.line.me/v2/bot/channel/webhook/endpoint";
const fail = (code: string): never => { throw new Error(code); };

/** Callback URLs are data sent to the fixed provider API, never fetch targets. */
export function validateLegacyWebhookCallback(value: string, integrationId: string, appUrl = process.env.NEXT_PUBLIC_APP_URL) {
  if (!appUrl) return fail("CALLBACK_ORIGIN_REQUIRED");
  let target: URL, app: URL;
  try { target = new URL(value); app = new URL(appUrl); } catch { return fail("CALLBACK_INVALID"); }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== "https:" || app.protocol !== "https:" || target.origin !== app.origin
    || target.username || target.password || target.port || target.search || target.hash
    || isIP(host) || host.includes(":") || !host.includes(".") || /(^|\.)(localhost|local|internal)$/.test(host)
    || !/^[a-z0-9.-]+$/.test(host) || target.pathname !== `/api/webhooks/line/${integrationId}`
    || value !== `${target.origin}/api/webhooks/line/${integrationId}`) return fail("CALLBACK_NOT_ALLOWED");
  return value;
}

async function readBinding(id: string, db: Database = prisma, lock = false) {
  const [row] = await db.$queryRaw<Binding[]>(Prisma.sql`select i.id::text,i.organization_id::text,i.stall_id::text,s.name as stall_name,
    i.status,i.environment,i.provider_id,i.oa_destination,i.secret_reference::text,i.settings_json
    from public.notification_integrations i join public.stalls s on s.id=i.stall_id and s.organization_id=i.organization_id
    where i.id=${id}::uuid and i.provider='LINE' and i.sender_scope='LEGACY' ${lock ? Prisma.sql`for update of i` : Prisma.empty}`);
  if (!row) return fail("INTEGRATION_NOT_FOUND");
  return row;
}
function context(row: Binding) {
  const settings = lineIntegrationSettingsSchema.parse(row.settings_json), management = settings.webhookManagement;
  if (!management || !row.provider_id || !row.oa_destination || !row.secret_reference) return fail("MESSAGING_BINDING_REQUIRED");
  const channelBinding = hash([row.id,row.organization_id,row.stall_id,row.environment,row.provider_id,row.oa_destination,row.secret_reference,management.messagingChannelId]);
  return { row, settings, management, channelBinding };
}
type Context = ReturnType<typeof context>;
function authorizeTarget(ctx: Context, command: LineWebhookManagementCommand) {
  if (ctx.row.organization_id !== command.organizationId || ctx.row.stall_id !== command.stallId || ctx.row.id !== command.integrationId
    || ctx.row.environment !== command.environment || ctx.channelBinding !== command.channelBinding
    || ctx.management.version !== command.expectedVersion) return fail("TARGET_OR_VERSION_CHANGED");
  if (ctx.row.status !== "ACTIVE" || ctx.row.environment !== "local" || !ctx.management.localMock) return fail("LOCAL_MOCK_CONFIGURATION_REQUIRED");
  const transport = getLegacyLineMockTransport();
  if (!transport) return fail("LOCAL_MOCK_CONFIGURATION_REQUIRED");
  return transport;
}
function safeEndpoint(value: string, integrationId: string) {
  if (!value) return "";
  try { return validateLegacyWebhookCallback(value,integrationId); }
  catch { return "已遮蔽非本系統 Callback"; }
}
function publicContext(ctx: Context) {
  let localMockAvailable = false;
  try { localMockAvailable = ctx.row.status === "ACTIVE" && ctx.row.environment === "local" && ctx.management.localMock && !!getLegacyLineMockTransport(); } catch { /* An unavailable Mock stays disabled. */ }
  return { integrationId: ctx.row.id, organizationId: ctx.row.organization_id, stallId: ctx.row.stall_id, stallName: ctx.row.stall_name,
    status: ctx.row.status, localMockAvailable, environment: ctx.row.environment, expectedVersion: ctx.management.version, channelBinding: ctx.channelBinding,
    channelLabel: `••••${ctx.management.messagingChannelId.slice(-4)}`, callbackUrl: safeEndpoint(ctx.management.callbackUrl ?? "",ctx.row.id),
    senderPolicy: ctx.management.senderPolicy, localMock: ctx.management.localMock, capability: "DISABLED" as const };
}
export async function readLegacyWebhookManagement(integrationId: string) {
  const initial = context(await readBinding(integrationId));
  const transport = authorizeTarget(initial,{ operation: "TEST", integrationId, organizationId: initial.row.organization_id,
    stallId: initial.row.stall_id, environment: "local", channelBinding: initial.channelBinding,
    expectedVersion: initial.management.version, callbackUrl: "", senderPolicy: initial.management.senderPolicy });
  const secret = lineIntegrationSecretsSchema.parse(JSON.parse(await readNotificationSecret(initial.row.secret_reference!)));
  const remote = await remoteState(initial,transport,secret.channelAccessToken);
  const current = context(await readBinding(integrationId));
  if (current.channelBinding !== initial.channelBinding || current.management.version !== initial.management.version
    || current.row.status !== "ACTIVE") return fail("TARGET_OR_VERSION_CHANGED");
  return { state: "READ" as const, mode: "SIMULATED" as const, ...publicContext(current),
    remoteEndpoint: safeEndpoint(remote.endpoint,current.row.id), remoteActive: false, providerRevision: hash(remote.revision) };
}
export async function listLegacyWebhookManagement() {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`select id::text from public.notification_integrations
    where provider='LINE' and sender_scope='LEGACY' order by created_at desc limit 100`;
  const integrations = [];
  for (const row of rows) {
    const binding = await readBinding(row.id);
    try { integrations.push({ ...publicContext(context(binding)), configured: true }); }
    catch { integrations.push({ integrationId: binding.id, organizationId: binding.organization_id, stallId: binding.stall_id,
      stallName: binding.stall_name, configured: false, capability: "DISABLED", reason: "MESSAGING_BINDING_REQUIRED" }); }
  }
  return { mode: "LOCAL_MOCK", enabled: false, integrations };
}
async function providerRequest(transport: typeof fetch, token: string, url: string, method: string, body?: unknown, revision?: string) {
  const response = await transport(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
    ...(revision ? { "if-match": revision } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000), redirect: "error", cache: "no-store" });
  if (!response.ok) return fail("PROVIDER_EVIDENCE_REQUIRED");
  return response.json();
}
async function remoteState(ctx: Context, transport: typeof fetch, token: string) {
  const remote = remoteSchema.parse(await providerRequest(transport,token,providerEndpoint,"GET"));
  if (remote.providerId !== ctx.row.provider_id || remote.messagingChannelId !== ctx.management.messagingChannelId
    || remote.destination !== ctx.row.oa_destination) return fail("PROVIDER_CHANNEL_BINDING_CHANGED");
  return remote;
}
async function saveManagement(db: Database, ctx: Context, management: Context["management"]) {
  const settings = JSON.stringify({ ...ctx.settings, webhookManagement: management });
  await db.$executeRaw`update public.notification_integrations set settings_json=${settings}::jsonb where id=${ctx.row.id}::uuid`;
}
export async function manageLegacyWebhook(command: LineWebhookManagementCommand, actorId: string) {
  const initial = context(await readBinding(command.integrationId));
  const transport = authorizeTarget(initial,command);
  if (command.operation === "TEST") validateLegacyWebhookCallback(command.callbackUrl,command.integrationId);
  const tested = initial.management.tested;
  if (command.operation === "APPLY") {
    if (!tested || tested.actorId !== actorId || tested.version !== command.expectedVersion || tested.digest !== command.testedDigest
      || new Date(tested.expiresAt) <= new Date()
      || tested.digest !== hash([actorId,initial.channelBinding,tested.version,tested.callbackUrl,tested.senderPolicy,tested.providerRevision])) return fail("FRESH_TEST_REQUIRED");
    validateLegacyWebhookCallback(tested.callbackUrl,command.integrationId);
  }
  const secret = lineIntegrationSecretsSchema.parse(JSON.parse(await readNotificationSecret(initial.row.secret_reference!)));
  const remote = await remoteState(initial,transport,secret.channelAccessToken);
  if (command.operation === "TEST") {
    const test = z.object({ success: z.literal(true) }).strict().parse(await providerRequest(transport,secret.channelAccessToken,
      "https://api.line.me/v2/bot/channel/webhook/test","POST",{ endpoint: command.callbackUrl }));
    if (!test.success) return fail("WEBHOOK_TEST_FAILED");
    return prisma.$transaction(async tx => {
      const current = context(await readBinding(command.integrationId,tx,true));authorizeTarget(current,command);
      const version = current.management.version + 1;
      const tested = { digest: hash([actorId,current.channelBinding,version,command.callbackUrl,command.senderPolicy,remote.revision]),
        actorId,version,expiresAt: new Date(Date.now()+600000).toISOString(),providerRevision: remote.revision,
        callbackUrl: command.callbackUrl,senderPolicy: command.senderPolicy };
      await saveManagement(tx,current,{ ...current.management,version,tested });
      return { state: "TESTED" as const, mode: "SIMULATED" as const, ...publicContext({ ...current,management: { ...current.management,version } }),
        testedDigest: tested.digest, diff: { callbackUrl: { before: safeEndpoint(remote.endpoint,current.row.id),after: command.callbackUrl },
          senderPolicy: { before: current.management.senderPolicy,after: command.senderPolicy } }, expiresAt: tested.expiresAt };
    });
  }
  if (!tested || tested.providerRevision !== remote.revision) return fail("FRESH_TEST_REQUIRED");
  // Consume the exact tested version before I/O; ambiguous apply cannot be replayed.
  const consumedVersion = await prisma.$transaction(async tx => {
    const current = context(await readBinding(command.integrationId,tx,true));authorizeTarget(current,command);
    if (current.management.tested?.digest !== tested.digest) return fail("FRESH_TEST_REQUIRED");
    const version = current.management.version + 1;
    await saveManagement(tx,current,{ ...current.management,version,tested: undefined });return version;
  });
  await providerRequest(transport,secret.channelAccessToken,providerEndpoint,"PUT",{ endpoint: tested.callbackUrl,active: false },tested.providerRevision);
  const readback = await remoteState(initial,transport,secret.channelAccessToken);
  if (readback.endpoint !== tested.callbackUrl) return fail("PROVIDER_EVIDENCE_REQUIRED");
  return prisma.$transaction(async tx => {
    const current = context(await readBinding(command.integrationId,tx,true));
    authorizeTarget(current,{ ...command,expectedVersion: consumedVersion });
    if (current.management.tested) return fail("TARGET_OR_VERSION_CHANGED");
    const management = { ...current.management,version: consumedVersion+1,callbackUrl: tested.callbackUrl,senderPolicy: tested.senderPolicy };
    await saveManagement(tx,current,management);
    return { state: "APPLIED" as const, mode: "SIMULATED" as const, ...publicContext({ ...current,management }), remoteActive: false };
  });
}
