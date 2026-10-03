import {describe,it,expect,vi} from "vitest";
import {createPlatformPaymentRecoveryWorker} from "./line-platform-payment-worker";
import {PaymentProviderError} from "./types";
function fixture(){
  const job={id:"attempt",fence:"fence",recoveryAttempt:1};
  const repository={claimRecovery:vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null),finishRecovery:vi.fn().mockResolvedValue(true),view:vi.fn().mockResolvedValue({providerTransactionId:"2026092201234567891"})};
  const workflow={recover:vi.fn().mockResolvedValue({state:"SUCCEEDED",refundUnknown:false})};
  return{job,repository,workflow,run:createPlatformPaymentRecoveryWorker(repository as never,workflow as never,"local")};
}
describe("durable scheduled payment recovery",()=>{
  it("claims by environment and only checks existing payments, never authorizing a confirm",async()=>{
    const f=fixture();expect(await f.run()).toEqual([{attemptId:"attempt",outcome:"SETTLED"}]);
    expect(f.repository.claimRecovery).toHaveBeenCalledWith("local");expect(f.workflow.recover).toHaveBeenCalledWith("attempt",false);
    expect(f.repository.finishRecovery).toHaveBeenCalledWith(f.job,{settled:true,manualReason:undefined});
  });
  it("defers transport/credential failures with a sanitized persistent backoff outcome",async()=>{
    const f=fixture();f.workflow.recover.mockRejectedValue(new PaymentProviderError("LINE_PAY_CREDENTIAL_MISMATCH",503));
    expect(await f.run()).toEqual([{attemptId:"attempt",outcome:"DEFERRED"}]);
    expect(f.repository.finishRecovery).toHaveBeenCalledWith(f.job,{settled:false,errorCode:"LINE_PAY_CREDENTIAL_MISMATCH"});
  });
  it("escalates unprovable requests and fences stale worker results",async()=>{
    const f=fixture();f.repository.view.mockResolvedValue({providerTransactionId:null});f.workflow.recover.mockResolvedValue({state:"UNKNOWN",refundUnknown:false});f.repository.finishRecovery.mockResolvedValue(false);
    expect(await f.run()).toEqual([{attemptId:"attempt",outcome:"FENCED"}]);
    expect(f.repository.finishRecovery).toHaveBeenCalledWith(f.job,{settled:false,manualReason:"REQUEST_RESULT_UNPROVEN"});
  });
  it("bounds each invocation to two attempts even when callers request more",async()=>{
    const f=fixture();f.repository.claimRecovery.mockReset().mockResolvedValue(f.job);await f.run(200);
    expect(f.workflow.recover).toHaveBeenCalledTimes(2);
  });
});
