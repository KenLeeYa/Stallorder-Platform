import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { readBoundedText } from "@/server/delivery-platforms/bounded-text-reader";
import { assertTwdAmount, PaymentProviderError } from "./types";

const transactionId = z.string().regex(/^[1-9]\d{0,18}$/)
  .refine((value) => /^\d+$/.test(value) && BigInt(value) <= BigInt("9223372036854775807"));
const envelope = z.object({ returnCode: z.string().regex(/^\d{4}$/), info: z.unknown().optional() });
const money = z.number().int().nonnegative().max(100_000_000);
const paymentEvidence = z.object({
  transactionId,
  orderId: z.string(),
  payInfo: z.array(z.object({ amount: money })).min(1),
});
const MAX_RESPONSE_BYTES = 128 * 1024;

/** Node 24's reviver source preserves provider int64 identifiers before Number rounding. */
export function parseLinePayResponse(raw: string): unknown {
  return JSON.parse(raw, (key: string, value: unknown, context?: { source: string }) => {
    if (key === "transactionId" || key === "refundTransactionId") {
      return transactionId.parse(typeof value === "number" ? context?.source : value);
    }
    if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value))) {
      throw new PaymentProviderError("LINE_PAY_RESPONSE_INVALID", 502);
    }
    return value;
  });
}

async function readResponse(response: Response) {
  return envelope.parse(parseLinePayResponse(await readBoundedText(response, MAX_RESPONSE_BYTES, 25_000)));
}

type ExpectedPayment = { transactionId: string; orderId: string; amount: number; currency: "TWD" };
type Options = {
  channelId: string;
  channelSecret: string;
  callbackOrigin: string;
  fetchImpl?: typeof fetch;
  nonce?: () => string;
};

/** Protocol transport only. Callers must durably reserve operations before invoking it.
 * No LIVE endpoint, retry, database payment mutation, or invented payment webhook.
 */
export class LinePayV4SandboxClient {
  readonly environment = "SANDBOX" as const;
  readonly apiVersion = "v4" as const;
  private readonly options: Options;

  constructor(options: Options) {
    const origin = new URL(options.callbackOrigin);
    if (origin.protocol !== "https:" || origin.origin !== options.callbackOrigin
      || !/^\d+$/.test(options.channelId) || !options.channelSecret.trim()) {
      throw new PaymentProviderError("LINE_PAY_CONFIG_INVALID", 503);
    }
    this.options = Object.freeze({ ...options });
  }

  private async send(method: "GET" | "POST", path: string, data?: unknown, query = "") {
    const body = method === "POST" ? JSON.stringify(data) : undefined;
    const nonce = (this.options.nonce ?? randomUUID)();
    const signature = createHmac("sha256", this.options.channelSecret)
      .update(this.options.channelSecret + path + (body ?? query) + nonce)
      .digest("base64");
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `https://sandbox-api-pay.line.me${path}${query ? `?${query}` : ""}`,
        {
          method, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25_000),
          headers: {
            "Content-Type": "application/json",
            "X-LINE-ChannelId": this.options.channelId,
            "X-LINE-Authorization-Nonce": nonce,
            "X-LINE-Authorization": signature,
          },
        },
      );
      if (!response.ok) throw new Error("provider http error");
      return await readResponse(response);
    } catch {
      // The request may already have executed. Never expose credentials/body or retry here.
      throw new PaymentProviderError("LINE_PAY_RESULT_UNKNOWN", 502);
    }
  }

  private requireSuccess(result: z.infer<typeof envelope>) {
    if (result.returnCode !== "0000") {
      if (["1900", "1902", "1999"].includes(result.returnCode)) {
        throw new PaymentProviderError("LINE_PAY_RESULT_UNKNOWN", 502);
      }
      throw new PaymentProviderError(`LINE_PAY_API_${result.returnCode}`, 409);
    }
    return result.info;
  }

  async requestPayment(input: { orderId: string; amount: number; currency: "TWD"; returnState: string }) {
    assertTwdAmount(input.amount, input.currency);
    z.string().min(1).max(100).parse(input.orderId);
    z.string().regex(/^[A-Za-z0-9_-]{43,128}$/).parse(input.returnState);
    const callback = (kind: string) => `${this.options.callbackOrigin}/api/payments/line-pay/${kind}?state=${input.returnState}`;
    const result = await this.send("POST", "/v4/payments/request", {
      amount: input.amount, currency: input.currency, orderId: input.orderId,
      packages: [{ id: "1", amount: input.amount, products: [{ name: "StallOrder order", quantity: 1, price: input.amount }] }],
      options: { payment: { capture: true } },
      redirectUrls: { confirmUrl: callback("return"), cancelUrl: callback("cancel") },
    });
    const info = z.object({ transactionId, paymentUrl: z.object({ web: z.string().url() }) }).parse(this.requireSuccess(result));
    const url = new URL(info.paymentUrl.web);
    if (url.origin !== "https://sandbox-web-pay.line.me" || url.username || url.password) {
      throw new PaymentProviderError("LINE_PAY_PAYMENT_URL_INVALID", 502);
    }
    return { status: "PENDING_AUTH" as const, transactionId: info.transactionId, paymentUrl: url.href };
  }

  async checkPayment(id: string) {
    const result = await this.send("GET", `/v4/payments/requests/${transactionId.parse(id)}/check`);
    const statuses = {
      "0000": "PENDING_AUTH", "0110": "READY_TO_CONFIRM", "0121": "CANCELLED_OR_EXPIRED",
      "0122": "FAILED", "0123": "REQUIRES_RECONCILIATION",
    } as const;
    const status = statuses[result.returnCode as keyof typeof statuses];
    if (!status) throw new PaymentProviderError("LINE_PAY_RESULT_UNKNOWN", 502);
    return { status, returnCode: result.returnCode };
  }

  private validateEvidence(info: unknown, expected: ExpectedPayment) {
    const evidence = paymentEvidence.safeParse(info);
    if (!evidence.success || evidence.data.transactionId !== expected.transactionId
      || evidence.data.orderId !== expected.orderId
      || evidence.data.payInfo.reduce((sum, item) => sum + item.amount, 0) !== expected.amount) {
      throw new PaymentProviderError("LINE_PAY_EVIDENCE_MISMATCH", 502);
    }
    return { transactionId: evidence.data.transactionId, orderId: expected.orderId, amount: expected.amount, currency: expected.currency };
  }

  async confirmPayment(input: ExpectedPayment) {
    assertTwdAmount(input.amount, input.currency);
    const result = await this.send("POST", `/v4/payments/${transactionId.parse(input.transactionId)}/confirm`, {
      amount: input.amount, currency: input.currency,
    });
    return { status: "CONFIRMED" as const, ...this.validateEvidence(this.requireSuccess(result), input) };
  }

  async retrievePayment(input: ExpectedPayment) {
    assertTwdAmount(input.amount, input.currency);
    const query = new URLSearchParams({ transactionId: transactionId.parse(input.transactionId) }).toString();
    const result = await this.send("GET", "/v4/payments", undefined, query);
    const items = z.array(paymentEvidence.extend({ currency: z.literal("TWD"), transactionType: z.literal("PAYMENT") })).parse(this.requireSuccess(result));
    if (items.length !== 1) throw new PaymentProviderError("LINE_PAY_EVIDENCE_MISMATCH", 502);
    return { status: "CONFIRMED" as const, ...this.validateEvidence(items[0], input) };
  }

  async refundPayment(input: { transactionId: string; amount: number; currency: "TWD" }) {
    assertTwdAmount(input.amount, input.currency);
    const result = await this.send("POST", `/v4/payments/${transactionId.parse(input.transactionId)}/refund`, { refundAmount: input.amount });
    const info = z.object({ refundTransactionId: transactionId }).parse(this.requireSuccess(result));
    return { refundTransactionId: info.refundTransactionId, amount: input.amount };
  }

  async retrieveRefunds(input: ExpectedPayment) {
    assertTwdAmount(input.amount,input.currency);
    const query=new URLSearchParams({transactionId:transactionId.parse(input.transactionId)}).toString();
    const result=await this.send("GET","/v4/payments",undefined,query);
    const refund=z.object({refundTransactionId:transactionId,transactionType:z.enum(["PARTIAL_REFUND","PAYMENT_REFUND"]),refundAmount:z.number().int().negative().min(-100_000_000),refundTransactionDate:z.string().datetime()});
    const items=z.array(paymentEvidence.extend({currency:z.literal("TWD"),transactionType:z.literal("PAYMENT"),refundList:z.array(refund).default([])})).parse(this.requireSuccess(result));
    if(items.length!==1) throw new PaymentProviderError("LINE_PAY_EVIDENCE_MISMATCH",502);
    this.validateEvidence(items[0],input);
    const refunds=items[0].refundList;
    if(new Set(refunds.map(item=>item.refundTransactionId)).size!==refunds.length) throw new PaymentProviderError("LINE_PAY_REFUND_EVIDENCE_AMBIGUOUS",502);
    return refunds.map(item=>({refundTransactionId:item.refundTransactionId,amount:-item.refundAmount,occurredAt:item.refundTransactionDate}));
  }
}
