import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionPrincipal } from "@/lib/auth";
import { acceptPlatformMembership, bindPlatformOrderOwner, getPlatformMember, listPlatformOrders, requirePlatformOrderOwner } from "./member-service";
import { encryptPlatformValue, hashPlatformSubject } from "./crypto";
import { getLinePlatformRuntime } from "./runtime";
import { claimGuestPlatformOrder, issueGuestClaimProof } from "./guest-claim";
import { assertResponsiveQaTarget } from "../../../scripts/responsive-qa-target.mjs";

const testUrl = process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (process.env.RESPONSIVE_QA_RUN === "true") {
    assertResponsiveQaTarget(process.env);
    if (testUrl !== process.env.DATABASE_URL) throw new Error("MEMBER_TEST_DATABASE_REJECTED");
  } else if (!["127.0.0.1","localhost"].includes(url.hostname) || url.port!=="55722" || url.pathname!=="/stallorder_line_miniapp_20260926") throw new Error("MEMBER_TEST_DATABASE_REJECTED");
}
const config = { environment: "local", providerId: "1234567", channelId: "1234568", liffId: "1234568-fixture", internalChannel: "developing", endpointUrl: "https://pickup.local.test/mini", oaDestination: `U${"a".repeat(32)}`, oaChannelId: "1234569", oaAccessTokenReference: randomUUID(), oaSecretReference: randomUUID(), termsVersion: "test-v1" };
const org = "11111111-1111-4111-8111-111111111111";
const stalls = [randomUUID(),randomUUID()];
const customers: SessionPrincipal[] = [];
const orders: string[] = [];
const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
function principal(id: string): SessionPrincipal { return { sessionId:randomUUID(),sessionExpiresAt:new Date(Date.now()+60_000),csrfTokenHash:"fixture",user:{id,authUserId:null,email:null,displayName:"合成會員",platformRole:null} }; }
async function createOrder(stallId: string) {
  return prisma.order.create({ data: { organizationId:org,stallId,orderNo:`M-${randomUUID().slice(0,16)}`,source:"QR_MENU",origin:"TEST",isTest:true,
    customerName:"合成會員",fulfillmentType:"TAKEOUT",status:"CONFIRMED",subtotal:100,total:100,deviceHash:digest(),
    trackingTokenHash:digest(),idempotencyKey:randomUUID(),confirmationExpiresAt:new Date(Date.now()+60_000) } });
}
describe.skipIf(!testUrl)("platform member real database authorization", () => {
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL",testUrl!); vi.stubEnv("NODE_ENV","test"); vi.stubEnv("VERCEL_ENV","");
    vi.stubEnv("LINE_PLATFORM_ENABLED","true"); vi.stubEnv("LINE_PLATFORM_ENVIRONMENT","local");
    vi.stubEnv("LINE_PLATFORM_PICKUP_ENABLED","true");
    vi.stubEnv("LINE_PLATFORM_DATA_KEY",Buffer.alloc(32,47).toString("base64"));
    vi.stubEnv("LINE_PLATFORM_BINDING_JSON",JSON.stringify(config));
    expect((await prisma.$queryRaw<Array<{db:string}>>`select current_database() as db`)[0].db).toBe(process.env.RESPONSIVE_QA_RUN === "true" ? "postgres" : "stallorder_line_miniapp_20260926");
    for (const stallId of stalls) {
      await prisma.stall.create({ data:{id:stallId,organizationId:org,name:`平台會員測試 ${stallId.slice(0,6)}`,code:`v2-${stallId}`,slug:`v2-member-${stallId}`,address:"合成測試地址",location:"合成測試地點"} });
      await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${stallId}::uuid,'local',true,now()-interval '1 hour')`;
    }
    for (let index=0;index<2;index++) {
      const profile=await prisma.profile.create({data:{displayName:"合成會員"}});
      const raw=`U${randomUUID().replaceAll("-","")}`;
      const hash=hashPlatformSubject("local",config.providerId,raw);
      await prisma.authIdentity.create({data:{profileId:profile.id,provider:"LINE",providerSubject:`miniapp:local:${config.providerId}:${hash}`,
        providerMetadata:{subjectCiphertext:encryptPlatformValue(raw)}}});
      customers.push(principal(profile.id));
    }
  });
  afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });
  it("does not enroll without explicit current terms; consent is independent",async () => {
    await expect(acceptPlatformMembership(customers[0],{termsVersion:"test-v1",acceptTerms:false,notificationConsent:true})).rejects.toThrow("TERMS_REQUIRED");
    await expect(acceptPlatformMembership(customers[0],{termsVersion:"stale",acceptTerms:true,notificationConsent:true})).rejects.toThrow("TERMS_REQUIRED");
    expect(await getPlatformMember(customers[0])).toBeNull();
    const member=await acceptPlatformMembership(customers[0],{termsVersion:"test-v1",acceptTerms:true,notificationConsent:false});
    expect(member?.notification_consent).toBe(false);
    expect(await prisma.stallMembership.count({where:{profileId:customers[0].user.id}})).toBe(0);
    expect((await prisma.profile.findUniqueOrThrow({where:{id:customers[0].user.id}})).platformRole).toBeNull();
    await acceptPlatformMembership(customers[1],{termsVersion:"test-v1",acceptTerms:true,notificationConsent:false});
  });
  it("one owner can see both stores, another signed-in member cannot inspect either",async () => {
    for (const stallId of stalls) {
      const order=await createOrder(stallId); orders.push(order.id);
      await prisma.$transaction(db=>bindPlatformOrderOwner(db,order.id,{profileId:customers[0].user.id,runtime:getLinePlatformRuntime()!}));
    }
    expect((await listPlatformOrders(customers[0],{history:false,page:1,stallId:null})).map(o=>o.id).sort()).toEqual([...orders].sort());
    expect(await listPlatformOrders(customers[1],{history:false,page:1,stallId:null})).toHaveLength(0);
    expect(await listPlatformOrders(customers[0],{history:false,page:1,stallId:stalls[1]})).toHaveLength(1);
    await expect(requirePlatformOrderOwner(customers[1],orders[0])).rejects.toThrow("ORDER_NOT_FOUND");
    await expect(requirePlatformOrderOwner(null,orders[0])).rejects.toThrow("ORDER_NOT_FOUND");
  });
  it("cannot relink an order after another account logs in or bypass the immutable owner",async () => {
    await expect(prisma.$transaction(db=>bindPlatformOrderOwner(db,orders[0],{profileId:customers[1].user.id,runtime:getLinePlatformRuntime()!}))).rejects.toThrow("OWNER_CONFLICT");
    await expect(prisma.$executeRaw`update public.line_platform_order_owners set profile_id=${customers[1].user.id}::uuid where order_id=${orders[0]}::uuid`).rejects.toThrow("OWNER_IMMUTABLE");
    expect((await requirePlatformOrderOwner(customers[0],orders[0])).profile_id).toBe(customers[0].user.id);
  });
  it("owner plus original core write rollback together when the pilot is disabled",async () => {
    await prisma.$executeRaw`update public.line_platform_stalls set enabled=false where stall_id=${stalls[1]}::uuid`;
    const id=randomUUID();
    await expect(prisma.$transaction(async db=>{
      await db.order.create({data:{id,organizationId:org,stallId:stalls[1],orderNo:`R-${id.slice(0,16)}`,source:"QR_MENU",origin:"TEST",isTest:true,customerName:"合成",subtotal:100,total:100,deviceHash:digest(),trackingTokenHash:digest(),idempotencyKey:randomUUID(),confirmationExpiresAt:new Date()}});
      await bindPlatformOrderOwner(db,id,{profileId:customers[0].user.id,runtime:getLinePlatformRuntime()!});
    })).rejects.toThrow("OWNER_SCOPE_INVALID");
    expect(await prisma.order.findUnique({where:{id}})).toBeNull();
  });
  it("an existing owner can replay after pilot shutdown without moving to another member",async () => {
    await prisma.$transaction(db=>bindPlatformOrderOwner(db,orders[1],{profileId:customers[0].user.id,runtime:getLinePlatformRuntime()!}));
    await expect(prisma.$transaction(db=>bindPlatformOrderOwner(db,orders[1],{profileId:customers[1].user.id,runtime:getLinePlatformRuntime()!}))).rejects.toThrow("OWNER_CONFLICT");
  });
  it("guest claim requires the original used session plus device and long token; never a pickup number",async () => {
    vi.stubEnv("ABUSE_HASH_SECRET","synthetic-claim-fixture-only");
    const device=randomUUID(); const token=`sto_${randomBytes(32).toString("base64url")}`;
    const originalSession=`stos_${randomBytes(32).toString("base64url")}`;
    const proof=issueGuestClaimProof(originalSession,token,device)!;
    const trackingHash=createHash("sha256").update(token).digest("hex");
    const deviceHash=createHmac("sha256","synthetic-claim-fixture-only").update(`device:${device}`).digest("hex");
    const order=await createOrder(stalls[0]);
    await prisma.order.update({where:{id:order.id},data:{trackingTokenHash:trackingHash,deviceHash}});
    await expect(claimGuestPlatformOrder(customers[0],token,device,proof)).rejects.toThrow("ORDER_NOT_FOUND");
    const qr=await prisma.qrCode.create({data:{organizationId:org,stallId:stalls[0],token:randomUUID(),label:"合成歸戶測試"}});
    await prisma.orderSession.create({data:{organizationId:org,stallId:stalls[0],qrCodeId:qr.id,tokenHash:createHash("sha256").update(originalSession).digest("hex"),deviceHash,ipHash:digest(),status:"CONSUMED",orderId:order.id,expiresAt:new Date(Date.now()+60_000),usedAt:new Date()}});
    await expect(claimGuestPlatformOrder(customers[0],"123",device,proof)).rejects.toThrow("ORDER_NOT_FOUND");
    await expect(claimGuestPlatformOrder(customers[0],token,randomUUID(),proof)).rejects.toThrow("ORDER_NOT_FOUND");
    await expect(claimGuestPlatformOrder(customers[0],token,device,"")).rejects.toThrow("ORDER_NOT_FOUND");
    expect(await claimGuestPlatformOrder(customers[0],token,device,proof)).toBe(order.id);
    expect(await claimGuestPlatformOrder(customers[0],token,device,proof)).toBe(order.id);
    await expect(claimGuestPlatformOrder(customers[1],token,device,proof)).rejects.toThrow("OWNER_CONFLICT");
  });
  it("revoked membership cannot silently report successful re-enrollment",async () => {
    await prisma.$executeRaw`update public.line_platform_members set revoked_at=now() where profile_id=${customers[1].user.id}::uuid`;
    await expect(acceptPlatformMembership(customers[1],{termsVersion:"test-v1",acceptTerms:true,notificationConsent:true})).rejects.toThrow("IDENTITY_MISMATCH");
  });
  it("revoked identity loses private order access; authenticated SQL cannot enumerate members",async () => {
    await prisma.authIdentity.updateMany({where:{profileId:customers[0].user.id},data:{revokedAt:new Date()}});
    await expect(requirePlatformOrderOwner(customers[0],orders[0])).rejects.toThrow("ORDER_NOT_FOUND");
    await expect(prisma.$transaction(async db=>{ await db.$executeRaw`set local role authenticated`; return db.$queryRaw`select * from public.line_platform_members`; })).rejects.toThrow();
  });
});
