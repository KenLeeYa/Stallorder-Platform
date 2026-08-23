import { NextResponse } from "next/server";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import {
  mockAcceptanceScenarios,
  runLocalMockPaymentAcceptance,
} from "@/server/payment-providers/mock-workflow-service";
import { paymentProviderCodes } from "@/server/payment-providers/types";

const schema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid(),
  orderId: z.string().uuid(),
  provider: z.enum(paymentProviderCodes).refine((value) => value !== "CASH_MANUAL"),
  scenario: z.enum(mockAcceptanceScenarios),
}).strict();

export async function POST(request: Request) {
  const body = await readJson(request, "payment-mock-acceptance", { maxBytes: 8_192 });
  if (body.error) return body.error;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Mock 付款測試資料格式不正確。" }, { status: 400 });
  }
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) {
    return NextResponse.json({ error: "缺少有效的 Idempotency Key。" }, { status: 400 });
  }
  const authorization = await authorizeOrganizationApiRequest(
    request,
    parsed.data.organizationId,
    "MANAGE_PAYMENT_INTEGRATIONS",
    true,
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  if (!authorization.workspace.stalls.some((stall) => stall.id === parsed.data.stallId)) {
    return NextResponse.json(
      { error: "找不到指定攤位。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const result = await runLocalMockPaymentAcceptance({
      ...parsed.data,
      idempotencyKey,
      requestId: authorization.requestId,
      actorProfileId: authorization.principal.user.id,
    });
    return NextResponse.json(
      { transaction: result },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "";
    const code = [
      "PAYMENT_TEST_ORDER_NOT_UNPAID",
      "PAYMENT_MOCK_CONNECTION_NOT_READY",
      "PAYMENT_IDEMPOTENCY_CONFLICT",
      "PAYMENT_MOCK_MODE_REQUIRED",
      "PAYMENT_MOCK_FORBIDDEN",
    ].includes(rawCode) ? rawCode : "PAYMENT_MOCK_TEST_FAILED";
    logEvent("warn", "PAYMENT_MOCK_ACCEPTANCE_FAILED", {
      requestId: authorization.requestId,
      provider: parsed.data.provider,
      code,
    });
    const status = code.includes("NOT_UNPAID") || code.includes("NOT_READY") ? 409
      : code.includes("FORBIDDEN") ? 404
        : code.includes("REQUIRED") ? 503
          : 400;
    return NextResponse.json(
      { error: code },
      { status, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
