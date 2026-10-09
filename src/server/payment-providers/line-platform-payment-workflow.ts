import "server-only";
import { randomBytes } from "node:crypto";
import { decryptOAuthValue, encryptOAuthValue } from "@/server/auth/oauth/crypto";
import { LinePayV4SandboxClient } from "./line-pay-v4";
import { paymentRuntime, resolvePaymentCredential } from "./line-platform-payment-config";
import { paymentHash, platformPaymentRepository, type CheckoutInput, type PaymentAttempt, type PlatformPaymentRepository } from "./line-platform-payment-repository";
import { PaymentProviderError } from "./types";

type Runtime = ReturnType<typeof paymentRuntime>;
type Transport = Pick<LinePayV4SandboxClient, "requestPayment" | "checkPayment" | "confirmPayment" | "retrievePayment" | "refundPayment" | "retrieveRefunds">;
function assertEnvironment(attempt: PaymentAttempt, runtime: Runtime) {
  if (attempt.environment !== runtime.environment) throw new PaymentProviderError("LINE_PAY_ENVIRONMENT_MISMATCH", 404);
}
export function publicPaymentView(attempt: PaymentAttempt) {
  return { attemptId: attempt.id,orderId: attempt.orderId,state: attempt.state,paymentStatus: attempt.status,amount: attempt.amount,currency: attempt.currency,providerTransactionId: attempt.providerTransactionId,pendingRefundAmount: attempt.pendingRefundAmount,refundedAmount: attempt.refundedAmount,refundUnknown: attempt.refundUnknown };
}

export function createPlatformPaymentWorkflow(repository: PlatformPaymentRepository, clientFor: (attempt: PaymentAttempt) => Transport, runtime: Runtime) {
  return {
    async checkout(input: CheckoutInput) {
      const returnState = randomBytes(32).toString("base64url");
      const reserved = await repository.reserveCheckout({ ...input,environment: runtime.environment,callbackOrigin: runtime.callbackOrigin,returnStateHash: paymentHash(returnState) });
      assertEnvironment(reserved.attempt, runtime);
      if (reserved.lease) {
        try {
          const result = await clientFor(reserved.attempt).requestPayment({ orderId: reserved.attempt.merchantOrderId,amount: reserved.attempt.amount,currency: "TWD",returnState });
          await repository.completeRequest(reserved.lease,result.transactionId,encryptOAuthValue(result.paymentUrl,runtime.stateSecret));
        } catch {
          // Includes provider-success/local-commit-failure. Never issue another Request here.
          await repository.markUnknown(reserved.lease,"LINE_PAY_REQUEST_UNKNOWN");
        }
      }
      const attempt = await repository.view(reserved.attempt.id);
      return { ...publicPaymentView(attempt),paymentUrl: attempt.state === "PENDING_AUTH" && attempt.actionUrlCiphertext ? decryptOAuthValue(attempt.actionUrlCiphertext,runtime.stateSecret) : null };
    },
    async recover(attemptId: string, allowConfirm = false) {
      const attempt = await repository.view(attemptId); assertEnvironment(attempt,runtime);
      if ((["SUCCEEDED","MANUAL_REVIEW"].includes(attempt.state) && !attempt.refundUnknown) || ["FAILED","CANCELLED"].includes(attempt.state)) return publicPaymentView(attempt);
      if (!attempt.providerTransactionId) return publicPaymentView(attempt); // Request without an ID requires operator investigation.
      const client = clientFor(attempt);
      const lease = await repository.claim(attempt.id,"CHECK");
      const expected = { transactionId: attempt.providerTransactionId,orderId: attempt.merchantOrderId,amount: attempt.amount,currency: "TWD" as const };
      try {
        if(attempt.refundUnknown){
          const match=await repository.matchUnknownRefund(lease,await client.retrieveRefunds(expected));
          if(match)await repository.completeRefund(match.lease,match.evidence);
          return publicPaymentView(await repository.view(attempt.id));
        }
        const checked = await client.checkPayment(attempt.providerTransactionId);
        if (checked.status === "REQUIRES_RECONCILIATION") {
          const evidence = await client.retrievePayment(expected);
          await repository.commitPayment(lease,evidence);
        } else {
          await repository.completeCheck(lease,checked.status,checked.returnCode);
          if (checked.status === "READY_TO_CONFIRM" && allowConfirm) {
            // A previous Confirm operation, including UNKNOWN, cannot be sent again.
            const confirmLease = await repository.claim(attempt.id,"CONFIRM");
            try { await repository.commitPayment(confirmLease,await client.confirmPayment(expected)); }
            catch { await repository.markUnknown(confirmLease,"LINE_PAY_CONFIRM_UNKNOWN"); }
          }
        }
      } catch (error) {
        await repository.markUnknown(lease,"LINE_PAY_RECOVERY_UNKNOWN");
        if (error instanceof PaymentProviderError && error.code === "LINE_PAY_CONFIRM_REQUIRES_RECONCILIATION") throw error;
      }
      return publicPaymentView(await repository.view(attempt.id));
    },
    async resolveReturn(input: { state: string; transactionId?: string; orderId?: string; cancel: boolean }) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(input.state)) throw new PaymentProviderError("LINE_PAY_RETURN_INVALID",400);
      const attempt = await repository.findReturn(paymentHash(input.state),runtime.environment);
      if ((!input.cancel && (!input.transactionId || !input.orderId))
        || (input.transactionId !== undefined && input.transactionId !== attempt.providerTransactionId)
        || (input.orderId !== undefined && input.orderId !== attempt.merchantOrderId)) throw new PaymentProviderError("LINE_PAY_RETURN_INVALID",400);
      return attempt;
    },
    async refund(input: Parameters<PlatformPaymentRepository["reserveRefund"]>[0]) {
      const original = await repository.view(input.attemptId); assertEnvironment(original,runtime);
      // Resolve original immutable merchant credential before reserving the refund.
      const client = clientFor(original);
      const reserved = await repository.reserveRefund(input);
      if (reserved.lease) {
        try {
          const evidence = await client.refundPayment({ transactionId: reserved.attempt.providerTransactionId!,amount: reserved.refund.requestedAmount,currency: "TWD" });
          await repository.completeRefund(reserved.lease,evidence);
        } catch { await repository.markUnknown(reserved.lease,"LINE_PAY_REFUND_UNKNOWN"); }
      }
      return publicPaymentView(await repository.view(reserved.attempt.id));
    },
  };
}
export function platformPaymentWorkflow(newPayment = false) {
  const runtime = paymentRuntime(newPayment);
  return createPlatformPaymentWorkflow(platformPaymentRepository,(attempt) => {
    const credential = resolvePaymentCredential(attempt);
    return new LinePayV4SandboxClient({ channelId: credential.channelId,channelSecret: credential.channelSecret,callbackOrigin: attempt.callbackOrigin });
  },runtime);
}
