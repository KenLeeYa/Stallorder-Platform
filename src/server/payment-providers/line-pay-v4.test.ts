import { describe, expect, it, vi } from "vitest";
import { LinePayV4SandboxClient, parseLinePayResponse } from "./line-pay-v4";

const id = "2026092201234567891";
const options = { channelId: "1234567890", channelSecret: "synthetic-test-secret", callbackOrigin: "https://qa.example.test", nonce: () => "fixed-test-nonce" };
const reply = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });
const request = { orderId: "qa-order-1", amount: 100, currency: "TWD" as const, returnState: "s".repeat(43) };

describe("LINE Pay v4 sandbox protocol", () => {
  it("preserves raw unquoted 64-bit IDs without converting the rounded Number", () => {
    expect(parseLinePayResponse(`{"returnCode":"0000","info":{"transactionId":${id},"refundTransactionId":2026092201234567892,"amount":100}}`)).toEqual({ returnCode: "0000", info: { transactionId: id, refundTransactionId: "2026092201234567892", amount: 100 } });
    expect(() => parseLinePayResponse('{"returnCode":"0000","info":{"transactionId":2.026092201234567891e18}}')).toThrow();
    expect(() => parseLinePayResponse('{"info":{"transactionId":9223372036854775808}}')).toThrow();
  });

  it("signs exact POST bytes, keeps Request pending and validates payment host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(`{"returnCode":"0000","info":{"transactionId":${id},"paymentUrl":{"web":"https://sandbox-web-pay.line.me/web/payment/wait?transactionReserveId=test"}}}`));
    const client = new LinePayV4SandboxClient({ ...options, fetchImpl });
    expect(await client.requestPayment(request)).toMatchObject({ transactionId: id, status: "PENDING_AUTH" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sandbox-api-pay.line.me/v4/payments/request");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toMatchObject({ amount: 100, currency: "TWD", orderId: "qa-order-1", options: { payment: { capture: true } } });
    // Independently generated with Python hmac/hashlib, including the exact UTF-8 body.
    expect(init.headers["X-LINE-Authorization"]).toBe("A8m6Vpz/idVffiskwX2ocfxPOgNRL/2cJ/IDqtZ3hD0=");
  });

  it.each([["0000", "PENDING_AUTH"], ["0110", "READY_TO_CONFIRM"], ["0121", "CANCELLED_OR_EXPIRED"], ["0122", "FAILED"], ["0123", "REQUIRES_RECONCILIATION"]])("interprets check %s specifically as %s", async (code, status) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(JSON.stringify({ returnCode: code })));
    expect(await new LinePayV4SandboxClient({ ...options, fetchImpl }).checkPayment(id)).toEqual({ status, returnCode: code });
    expect(fetchImpl.mock.calls[0][0]).toContain(`/requests/${id}/check`);
  });

  it("validates confirmed transaction, merchant order and sum of actual payment methods", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(reply(`{"returnCode":"0000","info":{"transactionId":${id},"orderId":"qa-order-1","payInfo":[{"amount":90},{"amount":10}]}}`)));
    const client = new LinePayV4SandboxClient({ ...options, fetchImpl });
    expect(await client.confirmPayment({ ...request, transactionId: id })).toMatchObject({ status: "CONFIRMED", amount: 100, transactionId: id });
    await expect(client.confirmPayment({ ...request, transactionId: id, amount: 99 })).rejects.toThrow("LINE_PAY_EVIDENCE_MISMATCH");
  });

  it("never automatically retries a request with an unknown network result", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("contains secret URL"));
    await expect(new LinePayV4SandboxClient({ ...options, fetchImpl }).requestPayment(request)).rejects.toThrow("LINE_PAY_RESULT_UNKNOWN");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refund sends an explicit amount and preserves the refund ID", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply('{"returnCode":"0000","info":{"refundTransactionId":2026092201234567892}}'));
    const client = new LinePayV4SandboxClient({ ...options, fetchImpl });
    expect(await client.refundPayment({ transactionId: id, amount: 50, currency: "TWD" })).toMatchObject({ refundTransactionId: "2026092201234567892", amount: 50 });
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"refundAmount":50}');
    await expect(client.refundPayment({ transactionId: id, amount: 0, currency: "TWD" })).rejects.toThrow("PAYMENT_AMOUNT_INVALID");
  });

  it("HTTP 200 is not success and an injected payment URL is rejected", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply('{"returnCode":"1104"}')).mockResolvedValueOnce(reply(`{"returnCode":"0000","info":{"transactionId":${id},"paymentUrl":{"web":"https://evil.example/web/payment/wait"}}}`));
    const client = new LinePayV4SandboxClient({ ...options, fetchImpl });
    await expect(client.requestPayment(request)).rejects.toThrow("LINE_PAY_API_1104");
    await expect(client.requestPayment(request)).rejects.toThrow("LINE_PAY_PAYMENT_URL_INVALID");
  });

  it("signs GET's exact query and verifies details before accepting completed status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(`{"returnCode":"0000","info":[{"transactionId":${id},"orderId":"qa-order-1","currency":"TWD","transactionType":"PAYMENT","payInfo":[{"amount":100}]}]}`));
    const result = await new LinePayV4SandboxClient({ ...options, fetchImpl }).retrievePayment({ ...request, transactionId: id });
    expect(result).toMatchObject({ status: "CONFIRMED", amount: 100, transactionId: id });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://sandbox-api-pay.line.me/v4/payments?transactionId=${id}`);
    expect(fetchImpl.mock.calls[0][1].headers["X-LINE-Authorization"]).toBe("sbBhICurJ4FQiMbsaZC5IGgahObH8rn5/cpQkt/13P8=");
  });

  it.each(["1900", "1902", "1999", "9999"])("retains unknown check code %s for reconciliation", async (returnCode) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(JSON.stringify({ returnCode })));
    await expect(new LinePayV4SandboxClient({ ...options, fetchImpl }).checkPayment(id)).rejects.toThrow("LINE_PAY_RESULT_UNKNOWN");
  });

  it.each([500, 429, 302])("does not retry HTTP %s", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply("{}", status));
    await expect(new LinePayV4SandboxClient({ ...options, fetchImpl }).requestPayment(request)).rejects.toThrow("LINE_PAY_RESULT_UNKNOWN");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not accept a different order's valid receipt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(`{"returnCode":"0000","info":{"transactionId":${id},"orderId":"other-order","payInfo":[{"amount":100}]}}`));
    await expect(new LinePayV4SandboxClient({ ...options, fetchImpl }).confirmPayment({ ...request, transactionId: id })).rejects.toThrow("LINE_PAY_EVIDENCE_MISMATCH");
  });
  it.each([["PARTIAL_REFUND",50],["PAYMENT_REFUND",100]])("reconciles %s facts under the original payment, preserving int64 and negative provider amount", async (type,amount) => {
    const fetchImpl=vi.fn().mockResolvedValue(reply(`{"returnCode":"0000","info":[{"transactionId":${id},"orderId":"qa-order-1","currency":"TWD","transactionType":"PAYMENT","payInfo":[{"amount":100}],"refundList":[{"refundTransactionId":2026092201234567892,"transactionType":"${type}","refundAmount":-${amount},"refundTransactionDate":"2026-09-27T00:00:01Z"}]}]}`));
    const client=new LinePayV4SandboxClient({...options,fetchImpl});
    expect(await client.retrieveRefunds({...request,transactionId:id})).toEqual([{refundTransactionId:"2026092201234567892",amount,occurredAt:"2026-09-27T00:00:01Z"}]);
  });
  it.each([["PAYMENT",-100],["PAYMENT_REFUND",100],["PARTIAL_REFUND",0]])("rejects non-refund evidence %s with amount %s",async(type,amount)=>{
    const fetchImpl=vi.fn().mockResolvedValue(reply(`{"returnCode":"0000","info":[{"transactionId":${id},"orderId":"qa-order-1","currency":"TWD","transactionType":"PAYMENT","payInfo":[{"amount":100}],"refundList":[{"refundTransactionId":2026092201234567892,"transactionType":"${type}","refundAmount":${amount},"refundTransactionDate":"2026-09-27T00:00:01Z"}]}]}`));
    await expect(new LinePayV4SandboxClient({...options,fetchImpl}).retrieveRefunds({...request,transactionId:id})).rejects.toThrow();
  });
});
