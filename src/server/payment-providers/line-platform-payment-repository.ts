import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PaymentProviderError } from "./types";
import { resolvePaymentCredential, type CredentialSnapshot } from "./line-platform-payment-config";

export const paymentHash = (value: string) => createHash("sha256").update(value).digest("hex");
export type PaymentAttempt = CredentialSnapshot & {
  id: string; orderId: string; organizationId: string; stallId: string; amount: number; currency: "TWD";
  state: string; status: string; environment: string; merchantOrderId: string; providerTransactionId: string | null;
  callbackOrigin: string; actionUrlCiphertext: string | null; partialRefundEnabled: boolean;
  pendingRefundAmount: number; refundedAmount: number; refundUnknown: boolean;
};
export type PaymentLease = { id: string; fence: string; attempt: PaymentAttempt; refundId?: string; refundAmount?: number };
export type CheckoutInput = { orderId: string; profileId: string; expectedAmount: number; orderVersion: string; idempotencyKey: string };
export type PaymentEvidence = { transactionId: string; orderId: string; amount: number; currency: "TWD" };
export type PaymentRecoveryJob = { id: string; fence: string; recoveryAttempt: number };
type DB = Prisma.TransactionClient;
function failure(code: string, status = 409): never { throw new PaymentProviderError(code, status); }
const selectAttempt = Prisma.sql`select t.id,t.order_id as "orderId",t.organization_id as "organizationId",t.stall_id as "stallId",
  t.amount,t.currency,t.status,t.merchant_order_id as "merchantOrderId",t.provider_transaction_id as "providerTransactionId",
  a.state,a.environment,a.credential_reference as "credentialReference",a.credential_version as "credentialVersion",
  a.merchant_reference as "merchantReference",a.channel_id as "channelId",a.callback_origin as "callbackOrigin",
  a.action_url_ciphertext as "actionUrlCiphertext",a.partial_refund_enabled as "partialRefundEnabled",
  (select coalesce(sum(r.requested_amount),0)::integer from public.payment_provider_refunds r where r.transaction_id=t.id and r.status in ('REQUESTED','PROCESSING','UNKNOWN')) as "pendingRefundAmount",
  (select coalesce(sum(r.requested_amount),0)::integer from public.payment_provider_refunds r where r.transaction_id=t.id and r.status='SUCCEEDED') as "refundedAmount",
  exists(select 1 from public.payment_provider_refunds r where r.transaction_id=t.id and r.status='UNKNOWN') as "refundUnknown"
  from public.line_platform_payment_attempts a join public.payment_provider_transactions t on t.id=a.transaction_id`;
async function attemptById(db: DB, id: string) {
  const rows = await db.$queryRaw<PaymentAttempt[]>(Prisma.sql`${selectAttempt} where t.id=${id}::uuid`);
  return rows[0] ?? failure("LINE_PAY_ATTEMPT_NOT_FOUND", 404);
}
async function lockAttempt(db: DB, id: string) {
  // Every writer locks original order before attempt/refund, shared with pickup redemption.
  await db.$queryRaw(Prisma.sql`select o.id from public.orders o join public.line_platform_payment_attempts a on a.order_id=o.id where a.transaction_id=${id}::uuid for update of o`);
  await db.$queryRaw(Prisma.sql`select transaction_id from public.line_platform_payment_attempts where transaction_id=${id}::uuid for update`);
  return attemptById(db, id);
}
async function expireLeases(db: DB, attempt: PaymentAttempt, rejectBusy = true) {
  const expired = await db.$queryRaw<Array<{ refund_id: string | null }>>(Prisma.sql`
    update public.line_platform_payment_operations set status='UNKNOWN',last_error_code='LEASE_EXPIRED',updated_at=now()
    where transaction_id=${attempt.id}::uuid and status='IN_FLIGHT' and lease_expires_at<=now() returning refund_id`);
  for (const row of expired) if (row.refund_id) await db.paymentProviderRefund.update({ where: { id: row.refund_id }, data: { status: "UNKNOWN", sanitizedErrorCode: "LEASE_EXPIRED" } });
  if (expired.length && attempt.state !== "SUCCEEDED") await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state='UNKNOWN',last_error_code='LEASE_EXPIRED',updated_at=now() where transaction_id=${attempt.id}::uuid`);
  const busy = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`select id from public.line_platform_payment_operations where transaction_id=${attempt.id}::uuid and status='IN_FLIGHT'`);
  if (rejectBusy && busy.length) failure("LINE_PAY_OPERATION_BUSY");
}
async function newLease(db: DB, attempt: PaymentAttempt, kind: string, key: string, refundId?: string, refundAmount?: number): Promise<PaymentLease> {
  const id = randomUUID(); const fence = randomUUID();
  await db.$executeRaw(Prisma.sql`insert into public.line_platform_payment_operations(id,transaction_id,refund_id,kind,operation_key,status,fence,lease_expires_at)
    values(${id}::uuid,${attempt.id}::uuid,${refundId ?? null}::uuid,${kind},${key},'IN_FLIGHT',${fence}::uuid,now()+interval '90 seconds')`);
  return { id, fence, attempt, refundId, refundAmount };
}
async function requireLease(db: DB, lease: PaymentLease) {
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`select id from public.line_platform_payment_operations
    where id=${lease.id}::uuid and transaction_id=${lease.attempt.id}::uuid and fence=${lease.fence}::uuid and status='IN_FLIGHT' for update`);
  if (!rows.length) failure("LINE_PAY_OPERATION_FENCED");
}
async function finishLease(db: DB, lease: PaymentLease, evidence: unknown, status = "SUCCEEDED") {
  await db.$executeRaw(Prisma.sql`update public.line_platform_payment_operations set status=${status},evidence=${JSON.stringify(evidence)}::jsonb,updated_at=now() where id=${lease.id}::uuid and fence=${lease.fence}::uuid`);
}

export const platformPaymentRepository = {
  async claimRecovery(environment: string): Promise<PaymentRecoveryJob | null> {
    const fence=randomUUID();
    const rows=await prisma.$queryRaw<PaymentRecoveryJob[]>(Prisma.sql`
      with candidate as (
        select a.transaction_id from public.line_platform_payment_attempts a
        where a.environment=${environment} and not a.recovery_manual_review and a.next_recovery_at<=now()
          and (a.recovery_lease_until is null or a.recovery_lease_until<=now())
          and (a.state in ('REQUESTING','PENDING_AUTH','CONFIRMING','UNKNOWN') or exists(
            select 1 from public.payment_provider_refunds r where r.transaction_id=a.transaction_id and r.status in ('REQUESTED','PROCESSING','UNKNOWN')))
          and not exists(select 1 from public.line_platform_payment_operations op where op.transaction_id=a.transaction_id and op.status='IN_FLIGHT' and op.lease_expires_at>now())
        order by a.next_recovery_at,a.transaction_id for update of a skip locked limit 1
      ) update public.line_platform_payment_attempts a set recovery_fence=${fence}::uuid,
        recovery_lease_until=now()+interval '90 seconds',recovery_attempts=recovery_attempts+1
      from candidate where a.transaction_id=candidate.transaction_id
      returning a.transaction_id as id,a.recovery_fence as fence,a.recovery_attempts as "recoveryAttempt"`);
    return rows[0]??null;
  },
  async finishRecovery(job: PaymentRecoveryJob, input: { settled: boolean; manualReason?: string; errorCode?: string }) {
    return prisma.$transaction(async(db)=>{
      const attempt=await lockAttempt(db,job.id);
      const rows=await db.$queryRaw<Array<{id:string}>>(Prisma.sql`select transaction_id as id from public.line_platform_payment_attempts where transaction_id=${job.id}::uuid and recovery_fence=${job.fence}::uuid for update`);
      if(!rows.length)return false;
      const reason=input.manualReason??(!input.settled&&job.recoveryAttempt>=8?"RECOVERY_RETRY_EXHAUSTED":null);
      const delay=Math.min(3600,60*2**Math.min(job.recoveryAttempt-1,6));
      await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set recovery_fence=null,recovery_lease_until=null,
        recovery_manual_review=${Boolean(reason)},next_recovery_at=now()+${delay}*interval '1 second',
        last_error_code=${input.errorCode??reason??null},updated_at=now() where transaction_id=${job.id}::uuid`);
      if(reason){
        const existing=await db.paymentReconciliationCase.findFirst({where:{transactionId:job.id,reviewStatus:"OPEN",safeNotes:reason}});
        if(!existing)await db.paymentReconciliationCase.create({data:{organizationId:attempt.organizationId,stallId:attempt.stallId,transactionId:attempt.id,provider:"LINE_PAY",caseType:"STATUS_MISMATCH",currency:"TWD",safeNotes:reason}});
      }
      return true;
    });
  },
  async listMerchant(organizationId: string, stallId: string, environment: string) {
    return prisma.$queryRaw<Array<{attemptId:string;orderId:string;orderNo:string;state:string;paymentStatus:string;amount:number;refundedAmount:number;pendingRefundAmount:number;partialRefundEnabled:boolean;manualReview:boolean;caseCount:number;cases:Array<{id:string;reason:string}>;createdAt:Date}>>(Prisma.sql`
      select a.transaction_id as "attemptId",a.order_id as "orderId",o.order_no as "orderNo",a.state,t.status as "paymentStatus",t.amount,
        coalesce((select sum(r.requested_amount) from public.payment_provider_refunds r where r.transaction_id=t.id and r.status='SUCCEEDED'),0)::integer as "refundedAmount",
        coalesce((select sum(r.requested_amount) from public.payment_provider_refunds r where r.transaction_id=t.id and r.status in ('REQUESTED','PROCESSING','UNKNOWN')),0)::integer as "pendingRefundAmount",
        a.partial_refund_enabled as "partialRefundEnabled",a.recovery_manual_review as "manualReview",
        (select count(*)::integer from public.payment_reconciliation_cases c where c.transaction_id=t.id and c.review_status='OPEN') as "caseCount",
        coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'reason',c.safe_notes) order by c.created_at) from public.payment_reconciliation_cases c where c.transaction_id=t.id and c.review_status='OPEN'),'[]'::jsonb) as cases,a.created_at as "createdAt"
      from public.line_platform_payment_attempts a join public.payment_provider_transactions t on t.id=a.transaction_id join public.orders o on o.id=a.order_id
      where t.organization_id=${organizationId}::uuid and t.stall_id=${stallId}::uuid and a.environment=${environment}
      order by a.created_at desc limit 50`);
  },
  async reserveCheckout(input: CheckoutInput & { environment: string; callbackOrigin: string; returnStateHash: string }) {
    return prisma.$transaction(async (db) => {
      const rows = await db.$queryRaw<Array<{ id: string; organization_id: string; stall_id: string; total: number; updated_at: Date; status: string; payment_status: string; confirmation_expires_at: Date }>>(Prisma.sql`
        select o.id,o.organization_id,o.stall_id,o.total,o.updated_at,o.status,o.payment_status,o.confirmation_expires_at
        from public.orders o join public.line_platform_order_owners owner on owner.order_id=o.id
        join public.line_platform_members member on member.profile_id=owner.profile_id and member.revoked_at is null
          and member.environment=owner.environment and member.provider_id=owner.provider_id and member.subject_hash=owner.subject_hash
        join public.auth_identities identity on identity.id=member.auth_identity_id and identity.profile_id=member.profile_id and identity.revoked_at is null
        join public.line_platform_stalls enabled on enabled.stall_id=o.stall_id and enabled.enabled and enabled.environment=owner.environment
        where o.id=${input.orderId}::uuid and owner.profile_id=${input.profileId}::uuid and owner.environment=${input.environment} for update of o for share of member,identity`);
      const order = rows[0]; if (!order) failure("LINE_PAY_ORDER_NOT_FOUND", 404);
      const fingerprint = paymentHash(JSON.stringify([input.environment,input.orderId,input.expectedAmount,input.orderVersion]));
      const existing = await db.paymentProviderTransaction.findFirst({ where: { organizationId: order.organization_id, stallId: order.stall_id, provider: "LINE_PAY", idempotencyKeyHash: paymentHash(input.idempotencyKey) }, select: { id: true, orderId: true } });
      if (existing) {
        const [saved] = await db.$queryRaw<Array<{ request_fingerprint: string }>>(Prisma.sql`select request_fingerprint from public.line_platform_payment_attempts where transaction_id=${existing.id}::uuid`);
        if (existing.orderId !== input.orderId || saved?.request_fingerprint !== fingerprint) failure("PAYMENT_IDEMPOTENCY_CONFLICT");
        return { attempt: await attemptById(db, existing.id), lease: null };
      }
      if (order.payment_status !== "UNPAID" || ["CANCELLED","EXPIRED","COMPLETED"].includes(order.status)
        || (order.status === "WAITING_CONFIRMATION" && order.confirmation_expires_at <= new Date())) failure("LINE_PAY_ORDER_NOT_PAYABLE");
      if (order.total !== input.expectedAmount || order.updated_at.toISOString() !== input.orderVersion) failure("LINE_PAY_ORDER_CHANGED");
      const stall=await db.stall.findUnique({where:{id:order.stall_id},select:{currency:true}});
      if(stall?.currency!=="TWD")failure("PAYMENT_CURRENCY_UNSUPPORTED");
      const active = await db.$queryRaw(Prisma.sql`select transaction_id from public.line_platform_payment_attempts where order_id=${order.id}::uuid and state in ('REQUESTING','PENDING_AUTH','CONFIRMING','UNKNOWN','MANUAL_REVIEW')`);
      if ((active as unknown[]).length) failure("LINE_PAY_PAYMENT_UNRESOLVED");
      const connection = await db.paymentProviderConnection.findFirst({ where: { organizationId: order.organization_id, stallId: order.stall_id, provider: "LINE_PAY", environment: "SANDBOX", status: "ACTIVE", enabledChannels: { has: "PUBLIC_MENU" } } });
      const capabilities = connection?.capabilities as Record<string, unknown> | undefined;
      if (!connection?.secretReference || !connection.merchantReference || capabilities?.apiVersion !== "v4" || typeof capabilities.credentialVersion !== "string") failure("LINE_PAY_CONNECTION_UNAVAILABLE", 503);
      const snapshot = { credentialReference: connection.secretReference, credentialVersion: capabilities.credentialVersion, merchantReference: connection.merchantReference };
      const credential = resolvePaymentCredential(snapshot);
      const id = randomUUID();
      await db.paymentProviderTransaction.create({ data: { id,organizationId: order.organization_id,stallId: order.stall_id,orderId: order.id,providerConnectionId: connection.id,provider: "LINE_PAY",merchantOrderId: `lp_${id.replaceAll("-", "")}`,amount: order.total,currency: "TWD",status: "PENDING",idempotencyKeyHash: paymentHash(input.idempotencyKey) } });
      await db.$executeRaw(Prisma.sql`insert into public.line_platform_payment_attempts(transaction_id,order_id,environment,state,request_fingerprint,return_state_hash,return_expires_at,credential_reference,credential_version,merchant_reference,channel_id,callback_origin,partial_refund_enabled)
        values(${id}::uuid,${order.id}::uuid,${input.environment},'REQUESTING',${fingerprint},${input.returnStateHash},now()+interval '30 minutes',${snapshot.credentialReference},${snapshot.credentialVersion},${snapshot.merchantReference},${credential.channelId},${input.callbackOrigin},${capabilities.partialRefund === true})`);
      const attempt = await attemptById(db, id);
      return { attempt, lease: await newLease(db, attempt, "REQUEST", "request") };
    });
  },
  async view(id: string, scope?: {organizationId:string;stallId:string;environment:string}) {
    return prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db,id);
      if(scope&&(attempt.organizationId!==scope.organizationId||attempt.stallId!==scope.stallId||attempt.environment!==scope.environment))failure("LINE_PAY_ATTEMPT_NOT_FOUND",404);
      await expireLeases(db,attempt,false);
      return attemptById(db,id);
    });
  },
  async findReturn(hash: string, environment: string) {
    const rows = await prisma.$queryRaw<PaymentAttempt[]>(Prisma.sql`${selectAttempt} where a.return_state_hash=${hash} and a.environment=${environment} and a.return_expires_at>now()`);
    return rows[0] ?? failure("LINE_PAY_RETURN_INVALID", 400);
  },
  async claim(id: string, kind: "CHECK" | "CONFIRM") {
    return prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db, id); await expireLeases(db, attempt);
      if (kind === "CONFIRM") {
        const previous = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`select id from public.line_platform_payment_operations where transaction_id=${id}::uuid and kind='CONFIRM'`);
        if (previous.length || ["SUCCEEDED","FAILED","CANCELLED"].includes(attempt.state)) failure("LINE_PAY_CONFIRM_REQUIRES_RECONCILIATION");
        await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state='CONFIRMING',updated_at=now() where transaction_id=${id}::uuid`);
      }
      return newLease(db, attempt, kind, kind === "CONFIRM" ? "confirm" : randomUUID());
    });
  },
  async completeRequest(lease: PaymentLease, transactionId: string, actionUrlCiphertext: string) {
    await prisma.$transaction(async (db) => {
      await lockAttempt(db, lease.attempt.id); await requireLease(db, lease);
      await db.paymentProviderTransaction.update({ where: { id: lease.attempt.id }, data: { providerTransactionId: transactionId, status: "REQUIRES_CUSTOMER_ACTION", lastVerifiedAt: new Date() } });
      await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state='PENDING_AUTH',action_url_ciphertext=${actionUrlCiphertext},updated_at=now() where transaction_id=${lease.attempt.id}::uuid`);
      await finishLease(db, lease, { transactionId, returnCode: "0000" });
    });
  },
  async completeCheck(lease: PaymentLease, status: string, returnCode: string) {
    await prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db, lease.attempt.id); await requireLease(db, lease);
      // A cancel URL is never evidence. Only an authenticated check may end an unpaid attempt.
      if (["CANCELLED_OR_EXPIRED","FAILED"].includes(status) && !["PAID","PARTIALLY_REFUNDED","REFUNDED"].includes(attempt.status)) {
        const state = status === "FAILED" ? "FAILED" : "CANCELLED";
        await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state=${state},updated_at=now() where transaction_id=${attempt.id}::uuid`);
        await db.paymentProviderTransaction.update({ where: { id: attempt.id }, data: { status: state, providerStatus: returnCode, lastVerifiedAt: new Date() } });
      }
      await finishLease(db, lease, { status, returnCode });
    });
  },
  async commitPayment(lease: PaymentLease, evidence: PaymentEvidence) {
    await prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db, lease.attempt.id); await requireLease(db, lease);
      if (evidence.transactionId !== attempt.providerTransactionId || evidence.orderId !== attempt.merchantOrderId
        || evidence.amount !== attempt.amount || evidence.currency !== attempt.currency) failure("LINE_PAY_EVIDENCE_MISMATCH");
      const order = await db.order.findUniqueOrThrow({ where: { id: attempt.orderId } });
      const payment = await db.payment.findUnique({ where: { orderId: order.id } });
      const reference = `PROVIDER:LINE_PAY:${evidence.transactionId}`;
      const conflict = (payment && (payment.reference !== reference || payment.amount !== attempt.amount))
        || order.total !== attempt.amount || ["CANCELLED","EXPIRED"].includes(order.status)
        || (!payment && order.paymentStatus !== "UNPAID");
      // Preserve successful external evidence even when fulfillment/payment conflicts require compensation.
      await db.paymentProviderTransaction.update({ where: { id: attempt.id }, data: { status: "PAID", paidAt: new Date(), providerStatus: "CONFIRMED", lastVerifiedAt: new Date() } });
      if (conflict) {
        await db.paymentReconciliationCase.create({ data: { organizationId: attempt.organizationId,stallId: attempt.stallId,transactionId: attempt.id,provider: "LINE_PAY",caseType: "STATUS_MISMATCH",expectedAmount: order.total,actualAmount: attempt.amount,currency: "TWD",providerReference: evidence.transactionId,safeNotes: "PAID_ORDER_CONFLICT_REQUIRES_COMPENSATION" } });
      } else if (!payment) {
        await db.$queryRaw(Prisma.sql`select set_config('app.line_platform_payment_transaction',${attempt.id},true)`);
        await db.payment.create({ data: { organizationId: attempt.organizationId,stallId: attempt.stallId,orderId: attempt.orderId,amount: attempt.amount,method: "OTHER",status: "PAID",reference,methodLabel: "LINE Pay",reconciliationStatus: "RECONCILED",paidAt: new Date() } });
        // Existing order triggers enqueue receipt/print; no status/completedAt or billing mutation.
        await db.order.update({ where: { id: attempt.orderId }, data: { paymentStatus: "PAID", paidAt: new Date() } });
      }
      await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state=${conflict ? "MANUAL_REVIEW" : "SUCCEEDED"},last_error_code=${conflict ? "PAID_ORDER_CONFLICT" : null},updated_at=now() where transaction_id=${attempt.id}::uuid`);
      await finishLease(db, lease, evidence);
      await db.auditLog.create({ data: { organizationId: attempt.organizationId,stallId: attempt.stallId,action: "LINE_PAY_VERIFIED",entityType: "PAYMENT_PROVIDER_TRANSACTION",entityId: attempt.id,outcome: "SUCCESS",requestId: lease.id,metadata: JSON.stringify({ amount: attempt.amount,currency: "TWD",manualReview: Boolean(conflict) }) } });
    });
  },
  async markUnknown(lease: PaymentLease, code: string) {
    await prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db, lease.attempt.id);
      const changed = await db.$executeRaw(Prisma.sql`update public.line_platform_payment_operations set status='UNKNOWN',last_error_code=${code},updated_at=now() where id=${lease.id}::uuid and fence=${lease.fence}::uuid and status='IN_FLIGHT'`);
      if (!changed) return;
      if (lease.refundId) await db.paymentProviderRefund.update({ where: { id: lease.refundId }, data: { status: "UNKNOWN", sanitizedErrorCode: code } });
      if (attempt.state !== "SUCCEEDED") await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state='UNKNOWN',last_error_code=${code},updated_at=now() where transaction_id=${attempt.id}::uuid`);
    });
  },
  async reserveRefund(input: { attemptId: string; stallId: string; actorProfileId: string; amount?: number; reason: string; idempotencyKey: string }) {
    return prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db, input.attemptId);
      if (attempt.stallId !== input.stallId) failure("LINE_PAY_ATTEMPT_NOT_FOUND", 404);
      const existing = await db.paymentProviderRefund.findUnique({ where: { transactionId_idempotencyKeyHash: { transactionId: attempt.id,idempotencyKeyHash: paymentHash(input.idempotencyKey) } } });
      if (existing) {
        if (existing.reason !== input.reason || (input.amount !== undefined && existing.requestedAmount !== input.amount)) failure("PAYMENT_IDEMPOTENCY_CONFLICT");
        return { attempt, refund: existing, lease: null };
      }
      await expireLeases(db, attempt);
      if (!["PAID","PARTIALLY_REFUNDED"].includes(attempt.status) || !attempt.providerTransactionId) failure("LINE_PAY_NOT_REFUNDABLE");
      const refunds = await db.paymentProviderRefund.findMany({ where: { transactionId: attempt.id, status: { in: ["REQUESTED","PROCESSING","UNKNOWN","SUCCEEDED"] } } });
      if (refunds.some((r) => r.status !== "SUCCEEDED")) failure("LINE_PAY_REFUND_UNRESOLVED");
      const remaining = attempt.amount - refunds.reduce((sum,r) => sum + r.requestedAmount, 0);
      const amount = input.amount ?? remaining;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining || (amount !== remaining && !attempt.partialRefundEnabled)) failure("LINE_PAY_REFUND_AMOUNT_INVALID");
      const refund = await db.paymentProviderRefund.create({ data: { organizationId: attempt.organizationId,stallId: attempt.stallId,transactionId: attempt.id,requestedByProfileId: input.actorProfileId,requestedAmount: amount,currency: "TWD",reason: input.reason,status: "PROCESSING",idempotencyKeyHash: paymentHash(input.idempotencyKey) } });
      await db.auditLog.create({data:{organizationId:attempt.organizationId,stallId:attempt.stallId,actorProfileId:input.actorProfileId,action:"LINE_PAY_REFUND_REQUESTED",entityType:"PAYMENT_PROVIDER_REFUND",entityId:refund.id,outcome:"SUCCESS",requestId:refund.id,metadata:JSON.stringify({amount,currency:"TWD"})}});
      return { attempt,refund,lease: await newLease(db,attempt,"REFUND",refund.id,refund.id,amount) };
    });
  },
  async completeRefund(lease: PaymentLease, evidence: { refundTransactionId: string; amount: number }) {
    await prisma.$transaction(async (db) => {
      const attempt = await lockAttempt(db, lease.attempt.id); await requireLease(db, lease);
      if (!lease.refundId || evidence.amount !== lease.refundAmount) failure("LINE_PAY_REFUND_EVIDENCE_MISMATCH");
      const refund=await db.paymentProviderRefund.update({ where: { id: lease.refundId }, data: { status: "SUCCEEDED",providerRefundId: evidence.refundTransactionId,processedAt: new Date(),sanitizedErrorCode:null } });
      const sum = await db.paymentProviderRefund.aggregate({ where: { transactionId: attempt.id,status: "SUCCEEDED" }, _sum: { requestedAmount: true } });
      const full = sum._sum.requestedAmount === attempt.amount;
      await db.paymentProviderTransaction.update({ where: { id: attempt.id }, data: { status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",refundedAt: full ? new Date() : null } });
      if (full) {
        const payment = await db.payment.findUnique({ where: { orderId: attempt.orderId } });
        if (payment?.reference === `PROVIDER:LINE_PAY:${attempt.providerTransactionId}`) {
          await db.$queryRaw(Prisma.sql`select set_config('app.line_platform_payment_transaction',${attempt.id},true)`);
          await db.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
          await db.order.update({ where: { id: attempt.orderId }, data: { paymentStatus: "REFUNDED" } });
        }
        await db.$executeRaw(Prisma.sql`update public.line_platform_payment_attempts set state='SUCCEEDED',updated_at=now() where transaction_id=${attempt.id}::uuid`);
      }
      await finishLease(db, lease, evidence);
      await db.auditLog.create({data:{organizationId:attempt.organizationId,stallId:attempt.stallId,actorProfileId:refund.requestedByProfileId,action:"LINE_PAY_REFUND_VERIFIED",entityType:"PAYMENT_PROVIDER_REFUND",entityId:refund.id,outcome:"SUCCESS",requestId:lease.id,metadata:JSON.stringify({amount:evidence.amount,currency:"TWD",full})}});
    });
  },
  async matchUnknownRefund(lease: PaymentLease, facts: Array<{ refundTransactionId: string; amount: number; occurredAt: string }>) {
    return prisma.$transaction(async (db) => {
      const attempt=await lockAttempt(db,lease.attempt.id);await requireLease(db,lease);
      const refunds=await db.paymentProviderRefund.findMany({where:{transactionId:attempt.id,status:{in:["SUCCEEDED","UNKNOWN","PROCESSING","REQUESTED"]}}});
      const pending=refunds.filter(refund=>refund.status!=="SUCCEEDED");
      const recordedIds=new Set(refunds.flatMap(refund=>refund.providerRefundId?[refund.providerRefundId]:[]));
      const unmatched=facts.filter(fact=>!recordedIds.has(fact.refundTransactionId));
      const refund=pending.length===1 && pending[0].status==="UNKNOWN"?pending[0]:null;
      const matches=refund?unmatched.filter(fact=>fact.amount===refund.requestedAmount
        && Date.parse(fact.occurredAt)>=refund.requestedAt.getTime()-1000
        && Date.parse(fact.occurredAt)<=refund.requestedAt.getTime()+90_000):[];
      // An exact single unmatched money movement can settle the reserved amount. Extra movements,
      // missing previous refunds, wrong dates or amount remain an operator reconciliation case.
      const knownMatch=refunds.filter(r=>r.status==="SUCCEEDED").every(r=>facts.some(f=>f.refundTransactionId===r.providerRefundId&&f.amount===r.requestedAmount));
      if(!refund||unmatched.length!==1||matches.length!==1||!knownMatch){
        const existing=await db.paymentReconciliationCase.findFirst({where:{transactionId:attempt.id,reviewStatus:"OPEN",safeNotes:"REFUND_RESULT_UNPROVEN"}});
        if(!existing)await db.paymentReconciliationCase.create({data:{organizationId:attempt.organizationId,stallId:attempt.stallId,transactionId:attempt.id,provider:"LINE_PAY",caseType:"STATUS_MISMATCH",currency:"TWD",safeNotes:"REFUND_RESULT_UNPROVEN"}});
        await finishLease(db,lease,{refundOutcome:"MANUAL_REVIEW",unmatchedCount:unmatched.length});
        return null;
      }
      // The CHECK lease remains held; completeRefund commits the evidence using the same fence.
      return {lease:{...lease,refundId:refund.id,refundAmount:refund.requestedAmount},evidence:matches[0]};
    });
  },
};
export type PlatformPaymentRepository = typeof platformPaymentRepository;
