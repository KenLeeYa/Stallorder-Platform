import "server-only";
import { paymentRuntime } from "./line-platform-payment-config";
import { platformPaymentRepository, type PlatformPaymentRepository } from "./line-platform-payment-repository";
import { platformPaymentWorkflow, type createPlatformPaymentWorkflow } from "./line-platform-payment-workflow";
import { PaymentProviderError } from "./types";

type RecoveryRepository=Pick<PlatformPaymentRepository,"claimRecovery"|"finishRecovery"|"view">;
type Workflow=Pick<ReturnType<typeof createPlatformPaymentWorkflow>,"recover">;
export function createPlatformPaymentRecoveryWorker(repository:RecoveryRepository,workflow:Workflow,environment:string){
  return async function process(limit=2){
    const results:Array<{attemptId:string;outcome:string}>=[];
    for(let index=0;index<Math.max(0,Math.min(2,limit));index++){
      const job=await repository.claimRecovery(environment);if(!job)break;
      try{
        // No REQUEST, CONFIRM or REFUND is sent by this worker. Original merchant snapshots
        // are resolved inside recover, including when creation of new payments is paused.
        const payment=await workflow.recover(job.id,false);
        const attempt=await repository.view(job.id);
        const settled=["FAILED","CANCELLED"].includes(payment.state)||payment.state==="SUCCEEDED"&&!payment.refundUnknown;
        const manualReason=!attempt.providerTransactionId?"REQUEST_RESULT_UNPROVEN"
          :payment.refundUnknown?"REFUND_RESULT_UNPROVEN":payment.state==="MANUAL_REVIEW"?"PAID_ORDER_CONFLICT_REQUIRES_COMPENSATION":undefined;
        const stored=await repository.finishRecovery(job,{settled,manualReason});
        results.push({attemptId:job.id,outcome:stored?(manualReason?"MANUAL_REVIEW":settled?"SETTLED":"DEFERRED"):"FENCED"});
      }catch(error){
        const errorCode=error instanceof PaymentProviderError?error.code:"LINE_PAY_RECOVERY_UNAVAILABLE";
        const stored=await repository.finishRecovery(job,{settled:false,errorCode});
        results.push({attemptId:job.id,outcome:stored?"DEFERRED":"FENCED"});
      }
    }
    return results;
  };
}
export async function processPlatformPaymentRecovery(){
  const runtime=paymentRuntime(false);
  return createPlatformPaymentRecoveryWorker(platformPaymentRepository,platformPaymentWorkflow(false),runtime.environment)();
}
