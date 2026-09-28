import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { LinePayV4SandboxClient } from "./line-pay-v4";
import { platformPaymentRepository,paymentHash } from "./line-platform-payment-repository";
import { createPlatformPaymentWorkflow } from "./line-platform-payment-workflow";
import { createPlatformPaymentRecoveryWorker } from "./line-platform-payment-worker";

const testUrl=process.env.LINE_PLATFORM_TEST_DATABASE_URL;
if(testUrl){const url=new URL(testUrl);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!=="55722"||url.pathname!=="/stallorder_line_miniapp_20260926")throw new Error("PAYMENT_TEST_DATABASE_REJECTED");}
const organizationId="11111111-1111-4111-8111-111111111111";
const profileId=randomUUID();const stallId=randomUUID();const actorId=randomUUID();
const runtime={environment:"local" as const,stateSecret:"synthetic-payment-data-key-32-characters-long",callbackOrigin:"https://payment.local.test"};
let connectionId="";
describe.skipIf(!testUrl)("LINE Pay isolated DB workflow with provider HTTP fixtures",()=>{
  beforeAll(async()=>{
    vi.stubEnv("DATABASE_URL",testUrl!);vi.stubEnv("NODE_ENV","test");
    vi.stubEnv("LINE_PAY_TEST_V1",JSON.stringify({channelId:"1234567",channelSecret:"synthetic-payment-secret",merchantReference:"fixture-merchant-a",version:"v1",environment:"SANDBOX"}));
    const [db]=await prisma.$queryRaw<Array<{name:string}>>`select current_database() as name`;expect(db.name).toBe("stallorder_line_miniapp_20260926");
    await prisma.profile.createMany({data:[{id:profileId,displayName:"Synthetic payment customer"},{id:actorId,displayName:"Synthetic payment operator"}]});
    const identity=await prisma.authIdentity.create({data:{profileId,provider:"LINE",providerSubject:`U${profileId.replaceAll("-","")}`}});
    await prisma.$executeRaw`insert into public.line_platform_members(profile_id,auth_identity_id,environment,provider_id,subject_hash,subject_ciphertext,terms_version,terms_accepted_at,terms_source)
      values(${profileId}::uuid,${identity.id}::uuid,'local','1234567',${paymentHash(profileId)},'synthetic-notification-disabled','test-v1',now(),'MINI_APP')`;
    await prisma.stall.create({data:{id:stallId,organizationId,name:"Synthetic payment test",slug:`payment-test-${stallId}`,code:`LP${stallId.slice(0,8)}`,location:"Fixture only",address:"Fixture only"}});
    await prisma.$executeRaw`insert into public.line_platform_stalls(stall_id,environment,enabled,cutover_at) values(${stallId}::uuid,'local',true,now()-interval '1 day')`;
    connectionId=(await prisma.paymentProviderConnection.create({data:{organizationId,stallId,provider:"LINE_PAY",environment:"SANDBOX",connectionMode:"DIRECT",status:"ACTIVE",secretReference:"env://LINE_PAY_TEST_V1",merchantReference:"fixture-merchant-a",enabledChannels:["PUBLIC_MENU"],capabilities:{apiVersion:"v4",credentialVersion:"v1",partialRefund:true}}})).id;
  });
  afterAll(async()=>{if(testUrl)await prisma.$disconnect();vi.unstubAllEnvs();});
  async function fixture(billable=false){
    const id=randomUUID();const order=await prisma.order.create({data:{id,organizationId,stallId,customerName:"Synthetic payment customer",orderNo:`LP-${id.slice(0,16)}`,trackingTokenHash:paymentHash(randomUUID()),idempotencyKey:randomUUID(),deviceHash:paymentHash(randomUUID()),source:"QR_MENU",origin:billable?"ONLINE_QR":"TEST",isTest:!billable,fulfillmentType:"TAKEOUT",status:"CONFIRMED",paymentStatus:"UNPAID",subtotal:100,total:100,confirmationExpiresAt:new Date(Date.now()+3600_000)}});
    await prisma.$executeRaw`insert into public.line_platform_order_owners(order_id,profile_id,environment,provider_id,subject_hash) values(${id}::uuid,${profileId}::uuid,'local','1234567',${paymentHash(profileId)})`;
    const providerId=(BigInt("2026092201234000000")+BigInt(Math.floor(Math.random()*1000000))).toString();
    let merchantOrderId="";let returnState="";let checkCode="0110";let refundLost=false;let requestLost=false;
    const refundId=(BigInt(providerId)+BigInt(1)).toString();let refundFacts:unknown[]=[];
    const fetchImpl=vi.fn(async(url: string|URL|Request,init?:RequestInit)=>{
      const path=String(url);const body=JSON.parse(String(init?.body??"{}"));
      if(path.endsWith("/request")){merchantOrderId=body.orderId;returnState=new URL(body.redirectUrls.confirmUrl).searchParams.get("state")!;if(requestLost)throw new Error("fixture response lost");return new Response(`{"returnCode":"0000","info":{"transactionId":${providerId},"paymentUrl":{"web":"https://sandbox-web-pay.line.me/web/payment/wait?fixture=1"}}}`);}
      if(path.endsWith("/check"))return Response.json({returnCode:checkCode});
      if(path.endsWith("/refund")){refundFacts=[{refundTransactionId:refundId,transactionType:"PARTIAL_REFUND",refundAmount:-body.refundAmount,refundTransactionDate:new Date().toISOString()}];if(refundLost)throw new Error("fixture refund response lost");return new Response(`{"returnCode":"0000","info":{"refundTransactionId":${refundId}}}`);}
      const evidence={transactionId:providerId,orderId:merchantOrderId,currency:"TWD",transactionType:"PAYMENT",payInfo:[{amount:100}],refundList:refundFacts};
      if(path.endsWith("/confirm"))return Response.json({returnCode:"0000",info:evidence});
      return Response.json({returnCode:"0000",info:[evidence]});
    });
    const client=new LinePayV4SandboxClient({channelId:"1234567",channelSecret:"synthetic-payment-secret",callbackOrigin:runtime.callbackOrigin,fetchImpl:fetchImpl as typeof fetch});
    let commitError:unknown;
    const workflow=createPlatformPaymentWorkflow({...platformPaymentRepository,async commitPayment(...args){try{return await platformPaymentRepository.commitPayment(...args);}catch(error){commitError=error;throw error;}}},()=>client,runtime);
    const input={orderId:id,profileId,expectedAmount:100,orderVersion:order.updatedAt.toISOString(),idempotencyKey:randomUUID()};
    return{order,input,workflow,fetchImpl,providerId,refundId,assertCommitted(){if(commitError)throw commitError;},get returnState(){return returnState;},get merchantOrderId(){return merchantOrderId;},loseRequest(){requestLost=true;},loseRefund(){refundLost=true;},completed(){checkCode="0123";},pending(){checkCode="0000";},ambiguousRefund(){refundFacts.push({...refundFacts[0] as object,refundTransactionId:(BigInt(refundId)+BigInt(1)).toString()});}};
  }
  it("concurrent identical checkout sends one Request; mismatched payload and another owner are rejected",async()=>{
    const f=await fixture();const results=await Promise.all([f.workflow.checkout(f.input),f.workflow.checkout(f.input)]);
    expect(results[0].attemptId).toBe(results[1].attemptId);expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    await expect(f.workflow.checkout({...f.input,expectedAmount:101})).rejects.toThrow("PAYMENT_IDEMPOTENCY_CONFLICT");
    await expect(f.workflow.checkout({...f.input,profileId:actorId})).rejects.toThrow("LINE_PAY_ORDER_NOT_FOUND");
  });
  it("confirms exact int64 once into original ledger without completing order or charging billing",async()=>{
    const f=await fixture();const payment=await f.workflow.checkout(f.input);
    await f.workflow.resolveReturn({state:f.returnState,orderId:f.merchantOrderId,transactionId:f.providerId,cancel:false});
    await f.workflow.recover(payment.attemptId,true);f.assertCommitted();await f.workflow.recover(payment.attemptId,true);
    const order=await prisma.order.findUniqueOrThrow({where:{id:f.order.id},include:{payment:true}});
    expect(order.paymentStatus).toBe("PAID");expect(order.status).toBe("CONFIRMED");expect(order.completedAt).toBeNull();
    expect(order.payment?.reference).toBe(`PROVIDER:LINE_PAY:${f.providerId}`);
    expect(f.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/confirm"))).toHaveLength(1);
    expect(await prisma.usageEvent.count({where:{referenceId:f.order.id,eventType:"BILLABLE_ORDER_COMPLETED"}})).toBe(0);
  });
  it("UNKNOWN Request blocks another attempt, cash payment, terminal expiry and snapshot mutation",async()=>{
    const f=await fixture();f.loseRequest();const payment=await f.workflow.checkout(f.input);expect(payment.state).toBe("UNKNOWN");
    await expect(f.workflow.checkout({...f.input,idempotencyKey:randomUUID()})).rejects.toThrow("LINE_PAY_PAYMENT_UNRESOLVED");
    await expect(prisma.order.update({where:{id:f.order.id},data:{status:"EXPIRED"}})).rejects.toThrow("LINE_PAY_PAYMENT_UNRESOLVED");
    await expect(prisma.payment.create({data:{organizationId,stallId,orderId:f.order.id,amount:100,method:"OTHER",methodLabel:"Synthetic manual",status:"PAID"}})).rejects.toThrow("LINE_PAY_PAYMENT_UNRESOLVED");
    await expect(prisma.$executeRaw`update public.line_platform_payment_attempts set merchant_reference='other' where transaction_id=${payment.attemptId}::uuid`).rejects.toThrow("LINE_PAY_SNAPSHOT_IMMUTABLE");
  });
  it("refund response loss reserves balance, rejects another refund and reconciles one exact external movement",async()=>{
    const f=await fixture();const payment=await f.workflow.checkout(f.input);await f.workflow.recover(payment.attemptId,true);f.loseRefund();
    const input={attemptId:payment.attemptId,stallId,actorProfileId:actorId,reason:"Synthetic full refund",idempotencyKey:randomUUID()};
    const pending=await f.workflow.refund(input);expect(pending.refundUnknown).toBe(true);expect(pending.pendingRefundAmount).toBe(100);
    await expect(f.workflow.refund({...input,idempotencyKey:randomUUID()})).rejects.toThrow("LINE_PAY_REFUND_UNRESOLVED");
    await f.workflow.refund(input);expect(f.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/refund"))).toHaveLength(1);
    const result=await f.workflow.recover(payment.attemptId);expect(result.paymentStatus).toBe("REFUNDED");expect(result.pendingRefundAmount).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).paymentStatus).toBe("REFUNDED");
  });
  it("ambiguous refund details retain the reservation and create a manual review case",async()=>{
    const f=await fixture();const payment=await f.workflow.checkout(f.input);await f.workflow.recover(payment.attemptId,true);f.loseRefund();
    await f.workflow.refund({attemptId:payment.attemptId,stallId,actorProfileId:actorId,reason:"Synthetic unknown refund",idempotencyKey:randomUUID()});f.ambiguousRefund();
    const result=await f.workflow.recover(payment.attemptId);expect(result.refundUnknown).toBe(true);expect(result.pendingRefundAmount).toBe(100);
    expect(await prisma.paymentReconciliationCase.count({where:{transactionId:payment.attemptId,safeNotes:"REFUND_RESULT_UNPROVEN"}})).toBe(1);
  });
  it("existing completion billing is charged once then a full refund credits once",async()=>{
    const f=await fixture(true);const payment=await f.workflow.checkout(f.input);await f.workflow.recover(payment.attemptId,true);f.assertCommitted();
    expect(await prisma.usageEvent.count({where:{referenceId:f.order.id,eventType:"BILLABLE_ORDER_COMPLETED"}})).toBe(0);
    await prisma.order.update({where:{id:f.order.id},data:{status:"COMPLETED",completedAt:new Date()}});
    expect(await prisma.usageEvent.count({where:{referenceId:f.order.id,eventType:"BILLABLE_ORDER_COMPLETED"}})).toBe(1);
    const refund={attemptId:payment.attemptId,stallId,actorProfileId:actorId,reason:"Synthetic billable refund",idempotencyKey:randomUUID()};
    await f.workflow.refund(refund);await f.workflow.refund(refund);
    expect(await prisma.usageEvent.count({where:{referenceId:f.order.id,eventType:"BILLABLE_ORDER_FULL_REFUND"}})).toBe(1);
    const events=await prisma.usageEvent.aggregate({where:{referenceId:f.order.id,eventType:{in:["BILLABLE_ORDER_COMPLETED","BILLABLE_ORDER_FULL_REFUND"]}},_sum:{quantity:true}});
    expect(events._sum.quantity).toBe(0);
  });
  it("partial refunds cannot exceed the remaining amount and do not pretend to be full refunds",async()=>{
    const f=await fixture();const payment=await f.workflow.checkout(f.input);await f.workflow.recover(payment.attemptId,true);
    const input={attemptId:payment.attemptId,stallId,actorProfileId:actorId,reason:"Synthetic partial refund",idempotencyKey:randomUUID(),amount:60};
    const result=await f.workflow.refund(input);expect(result.paymentStatus).toBe("PARTIALLY_REFUNDED");expect(result.refundedAmount).toBe(60);
    expect((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).paymentStatus).toBe("PAID");
    await expect(f.workflow.refund({...input,idempotencyKey:randomUUID(),amount:41})).rejects.toThrow("LINE_PAY_REFUND_AMOUNT_INVALID");
    expect(f.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/refund"))).toHaveLength(1);
  });
  it("a restarted worker recovers an expired Confirm lease through GET evidence and fences the old worker",async()=>{
    const f=await fixture();const payment=await f.workflow.checkout(f.input);
    const operation=await platformPaymentRepository.claim(payment.attemptId,"CONFIRM");f.completed();
    await prisma.$executeRaw`update public.line_platform_payment_operations set lease_expires_at=now()-interval '1 second' where id=${operation.id}::uuid`;
    await prisma.$executeRaw`update public.line_platform_payment_attempts set next_recovery_at='1970-01-01' where transaction_id=${payment.attemptId}::uuid`;
    const oldJob=await platformPaymentRepository.claimRecovery("local");expect(oldJob?.id).toBe(payment.attemptId);
    await prisma.$executeRaw`update public.line_platform_payment_attempts set recovery_lease_until=now()-interval '1 second' where transaction_id=${payment.attemptId}::uuid`;
    const run=createPlatformPaymentRecoveryWorker(platformPaymentRepository,f.workflow,"local");
    expect(await run(1)).toEqual([{attemptId:payment.attemptId,outcome:"SETTLED"}]);f.assertCommitted();
    expect(await platformPaymentRepository.finishRecovery(oldJob!,{settled:false,errorCode:"STALE_WORKER"})).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({where:{id:f.order.id}})).paymentStatus).toBe("PAID");
    expect(f.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/confirm"))).toHaveLength(0);
    expect(f.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/request"))).toHaveLength(1);
  });
  it("scheduled pending checks persist exponential backoff without sending another Request or Confirm",async()=>{
    const f=await fixture();f.pending();const payment=await f.workflow.checkout(f.input);
    await prisma.$executeRaw`update public.line_platform_payment_attempts set next_recovery_at='1970-01-01',recovery_attempts=2 where transaction_id=${payment.attemptId}::uuid`;
    const run=createPlatformPaymentRecoveryWorker(platformPaymentRepository,f.workflow,"local");expect(await run(1)).toEqual([{attemptId:payment.attemptId,outcome:"DEFERRED"}]);
    const [row]=await prisma.$queryRaw<Array<{attempts:number;delay:number;lease:Date|null}>>`select recovery_attempts as attempts,extract(epoch from(next_recovery_at-now()))::integer as delay,recovery_lease_until as lease from public.line_platform_payment_attempts where transaction_id=${payment.attemptId}::uuid`;
    expect(row.attempts).toBe(3);expect(row.delay).toBeGreaterThan(235);expect(row.delay).toBeLessThanOrEqual(240);expect(row.lease).toBeNull();
    expect(f.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/confirm"))).toHaveLength(0);
  });
  it("an unprovable Request is escalated once with its reservation intact",async()=>{
    const f=await fixture();f.loseRequest();const payment=await f.workflow.checkout(f.input);
    await prisma.$executeRaw`update public.line_platform_payment_attempts set next_recovery_at='1970-01-01' where transaction_id=${payment.attemptId}::uuid`;
    const run=createPlatformPaymentRecoveryWorker(platformPaymentRepository,f.workflow,"local");expect(await run(1)).toEqual([{attemptId:payment.attemptId,outcome:"MANUAL_REVIEW"}]);
    expect(await prisma.paymentReconciliationCase.count({where:{transactionId:payment.attemptId,safeNotes:"REQUEST_RESULT_UNPROVEN"}})).toBe(1);
    const listing=await platformPaymentRepository.listMerchant(organizationId,stallId,"local");
    expect(listing.find(item=>item.attemptId===payment.attemptId)).toMatchObject({caseCount:1,cases:[{reason:"REQUEST_RESULT_UNPROVEN"}],manualReview:true});
    expect(await platformPaymentRepository.listMerchant(organizationId,stallId,"preview")).toEqual([]);
    const [row]=await prisma.$queryRaw<Array<{manual:boolean}>>`select recovery_manual_review as manual from public.line_platform_payment_attempts where transaction_id=${payment.attemptId}::uuid`;expect(row.manual).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);await expect(f.workflow.checkout({...f.input,idempotencyKey:randomUUID()})).rejects.toThrow("LINE_PAY_PAYMENT_UNRESOLVED");
  });
  it.each(["identity","member"])("revoked %s blocks new checkout while trusted existing-payment recovery continues",async target=>{
    const existing=await fixture();const attempt=await existing.workflow.checkout(existing.input);existing.pending();
    const fresh=await fixture();
    if(target==="identity")await prisma.authIdentity.updateMany({where:{profileId},data:{revokedAt:new Date()}});
    else await prisma.$executeRaw`update public.line_platform_members set revoked_at=now() where profile_id=${profileId}::uuid`;
    try{
      await expect(fresh.workflow.checkout(fresh.input)).rejects.toThrow("LINE_PAY_ORDER_NOT_FOUND");
      expect(fresh.fetchImpl).not.toHaveBeenCalled();
      expect(await prisma.paymentProviderTransaction.count({where:{orderId:fresh.order.id}})).toBe(0);
      await existing.workflow.recover(attempt.attemptId,false);
      expect(existing.fetchImpl.mock.calls.filter(call=>String(call[0]).endsWith("/check"))).toHaveLength(1);
    }finally{
      if(target==="identity")await prisma.authIdentity.updateMany({where:{profileId},data:{revokedAt:null}});
      else await prisma.$executeRaw`update public.line_platform_members set revoked_at=null where profile_id=${profileId}::uuid`;
    }
  });
  it("connection rotation leaves the existing attempt bound to its original merchant credential",async()=>{
    const f=await fixture();const payment=await f.workflow.checkout(f.input);
    await prisma.paymentProviderConnection.update({where:{id:connectionId},data:{secretReference:"env://LINE_PAY_OTHER_V2",merchantReference:"other-merchant",capabilities:{apiVersion:"v4",credentialVersion:"v2"}}});
    const attempt=await platformPaymentRepository.view(payment.attemptId);expect(attempt.credentialReference).toBe("env://LINE_PAY_TEST_V1");expect(attempt.merchantReference).toBe("fixture-merchant-a");
    await f.workflow.recover(payment.attemptId,true);expect((await platformPaymentRepository.view(payment.attemptId)).status).toBe("PAID");
  });
});
