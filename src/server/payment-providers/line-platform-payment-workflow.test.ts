import { describe, expect, it, vi } from "vitest";
import { createPlatformPaymentWorkflow } from "./line-platform-payment-workflow";
import { PaymentProviderError } from "./types";

function fixture() {
  const attempt = { id: "attempt",orderId: "order",state: "PENDING_AUTH",status: "REQUIRES_CUSTOMER_ACTION",amount: 100,currency: "TWD",environment: "local",providerTransactionId: "2026092201234567891",merchantOrderId: "merchant-order" };
  const lease = { id: "operation",fence: "fence",attempt };
  const repository = {
    view: vi.fn(async () => ({ ...attempt })),
    findReturn: vi.fn(async () => ({ ...attempt })),
    claim: vi.fn(async () => lease),
    completeCheck: vi.fn(async () => undefined),
    commitPayment: vi.fn(async () => { attempt.state="SUCCEEDED"; attempt.status="PAID"; }),
    markUnknown: vi.fn(async () => { attempt.state="UNKNOWN"; }),
    reserveRefund: vi.fn(async () => ({ attempt,refund: { requestedAmount: 100 },lease: { ...lease,refundId: "refund",refundAmount: 100 } as typeof lease | null })),
    completeRefund: vi.fn(async () => { attempt.status="REFUNDED"; }),
  };
  const client = {
    checkPayment: vi.fn(async () => ({ status: "PENDING_AUTH",returnCode: "0000" })),
    confirmPayment: vi.fn(async () => ({ transactionId: attempt.providerTransactionId,orderId: attempt.merchantOrderId,amount: 100,currency: "TWD" })),
    retrievePayment: vi.fn(async () => ({ transactionId: attempt.providerTransactionId,orderId: attempt.merchantOrderId,amount: 100,currency: "TWD" })),
    refundPayment: vi.fn(async () => ({ refundTransactionId: "2026092201234567892",amount: 100 })),
  };
  const workflow = createPlatformPaymentWorkflow(repository as never,() => client as never,{ environment: "local",stateSecret: "synthetic-test-secret",callbackOrigin: "https://qa.example.test" });
  return { attempt,lease,repository,client,workflow };
}

describe("durable LINE Pay workflow", () => {
  it("reserves the request before provider I/O and leaves ambiguous success unresolved without a second request", async () => {
    const order: string[] = [];
    const attempt = { id: "attempt", orderId: "order", state: "REQUESTING", amount: 100, currency: "TWD", environment: "local" };
    const lease = { id: "operation", fence: "fence", attempt };
    const repository = { reserveCheckout: vi.fn(async () => { order.push("reserve"); return { attempt, lease }; }), markUnknown: vi.fn(async () => { order.push("unknown"); }), view: vi.fn(async () => ({ ...attempt, state: "UNKNOWN" })) };
    const client = { requestPayment: vi.fn(async () => { order.push("provider"); throw new Error("provider processed but response lost"); }) };
    // Public workflow seam; external adapter and durable repository are explicit dependencies.
    const workflow = createPlatformPaymentWorkflow(repository as never, () => client as never, { environment: "local", stateSecret: "synthetic-test-secret", callbackOrigin: "https://qa.example.test" });
    const result = await workflow.checkout({ orderId: "order", profileId: "profile", expectedAmount: 100, orderVersion: "version", idempotencyKey: "key" });
    expect(result.state).toBe("UNKNOWN");
    expect(order).toEqual(["reserve", "provider", "unknown"]);
    expect(client.requestPayment).toHaveBeenCalledTimes(1);
  });
  it("check 0000 remains pending and never confirms or materializes payment", async () => {
    const f=fixture();
    expect((await f.workflow.recover("attempt",true)).state).toBe("PENDING_AUTH");
    expect(f.client.confirmPayment).not.toHaveBeenCalled(); expect(f.repository.commitPayment).not.toHaveBeenCalled();
  });
  it("manual-review paid evidence is stable and cannot be downgraded by another check", async () => {
    const f=fixture();f.attempt.state="MANUAL_REVIEW";f.attempt.status="PAID";
    expect((await f.workflow.recover("attempt",true)).paymentStatus).toBe("PAID");
    expect(f.repository.claim).not.toHaveBeenCalled();expect(f.client.checkPayment).not.toHaveBeenCalled();
  });
  it("check 0110 confirms once after reserving the confirm operation, and replay returns the paid fact", async () => {
    const f=fixture(); f.client.checkPayment.mockResolvedValue({ status: "READY_TO_CONFIRM",returnCode: "0110" });
    expect((await f.workflow.recover("attempt",true)).paymentStatus).toBe("PAID");
    expect(f.repository.claim.mock.calls).toEqual([["attempt","CHECK"],["attempt","CONFIRM"]]);
    await f.workflow.recover("attempt",true);
    expect(f.client.confirmPayment).toHaveBeenCalledTimes(1);
    expect(f.repository.commitPayment).toHaveBeenCalledTimes(1);
  });
  it("cancel reconciliation checks actual state but does not confirm an authorized payment", async () => {
    const f=fixture(); f.client.checkPayment.mockResolvedValue({ status: "READY_TO_CONFIRM",returnCode: "0110" });
    await f.workflow.recover("attempt",false);
    expect(f.client.confirmPayment).not.toHaveBeenCalled();
  });
  it("check 0123 retrieves and validates completed details before materialization with the exact int64 ID", async () => {
    const f=fixture(); f.client.checkPayment.mockResolvedValue({ status: "REQUIRES_RECONCILIATION",returnCode: "0123" });
    await f.workflow.recover("attempt");
    expect(f.client.retrievePayment).toHaveBeenCalledWith({ transactionId: "2026092201234567891",orderId: "merchant-order",amount: 100,currency: "TWD" });
    expect(f.repository.commitPayment).toHaveBeenCalledOnce(); expect(f.client.confirmPayment).not.toHaveBeenCalled();
  });
  it("a successful Confirm followed by DB failure stays unknown and an earlier confirm cannot be repeated", async () => {
    const f=fixture(); f.client.checkPayment.mockResolvedValue({ status: "READY_TO_CONFIRM",returnCode: "0110" });
    f.repository.commitPayment.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await f.workflow.recover("attempt",true)).state).toBe("UNKNOWN");
    f.repository.claim.mockImplementation(async (_id?: string,kind?: string) => { if(kind === "CONFIRM") throw new PaymentProviderError("LINE_PAY_CONFIRM_REQUIRES_RECONCILIATION"); return f.lease; });
    await expect(f.workflow.recover("attempt",true)).rejects.toThrow("LINE_PAY_CONFIRM_REQUIRES_RECONCILIATION");
    expect(f.client.confirmPayment).toHaveBeenCalledTimes(1);
  });
  it("a missing transaction ID after Request timeout never creates another request during recovery", async () => {
    const f=fixture(); f.repository.view.mockResolvedValue({ ...f.attempt,providerTransactionId: null } as never);
    await f.workflow.recover("attempt",true); expect(f.repository.claim).not.toHaveBeenCalled();
  });
  it("callback state is not authority for a substituted merchant order or transaction", async () => {
    const f=fixture();
    await expect(f.workflow.resolveReturn({ state: "s".repeat(43),orderId: "different-order",transactionId: f.attempt.providerTransactionId,cancel: false })).rejects.toThrow("LINE_PAY_RETURN_INVALID");
    await expect(f.workflow.resolveReturn({ state: "s".repeat(43),orderId: f.attempt.merchantOrderId,transactionId: "2026092201234567892",cancel: false })).rejects.toThrow("LINE_PAY_RETURN_INVALID");
    expect(f.client.checkPayment).not.toHaveBeenCalled();
  });
  it("refund timeout retains the operation and an idempotent replay never sends another refund", async () => {
    const f=fixture(); f.client.refundPayment.mockRejectedValueOnce(new Error("response lost"));
    const input={ attemptId: "attempt",stallId: "stall",actorProfileId: "operator",reason: "customer request",idempotencyKey: "refund-key" };
    await f.workflow.refund(input); expect(f.repository.markUnknown).toHaveBeenCalledOnce();
    f.repository.reserveRefund.mockResolvedValueOnce({ attempt: f.attempt,refund: { requestedAmount: 100 },lease: null });
    await f.workflow.refund(input); expect(f.client.refundPayment).toHaveBeenCalledTimes(1);
  });
});
