import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { upsertLocalMockPaymentConnection } from "@/server/payment-providers/mock-workflow-service";
import { paymentProviderCodes } from "@/server/payment-providers/types";

const channels = ["DINE_IN", "TAKEOUT", "DELIVERY", "STAFF_POS", "PUBLIC_MENU"] as const;
const schema = z.object({
  organizationId: z.string().uuid(),
  stallId: z.string().uuid().nullable(),
  provider: z.enum(paymentProviderCodes).refine((value) => value !== "CASH_MANUAL"),
  environment: z.literal("MOCK"),
  enabledChannels: z.array(z.enum(channels)).max(channels.length),
}).strict();

export async function POST(request: Request) {
  const body = await readJson(request, "payment-connection", { maxBytes: 8_192 });
  if (body.error) return body.error;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "付款連線資料格式不正確。" }, { status: 400 });
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
  if (
    parsed.data.stallId
    && !authorization.workspace.stalls.some((stall) => stall.id === parsed.data.stallId)
  ) {
    return NextResponse.json(
      { error: "找不到指定攤位。" },
      { status: 404, headers: { "x-request-id": authorization.requestId } },
    );
  }

  try {
    const connection = await upsertLocalMockPaymentConnection(parsed.data);
    await recordAuditEvent({
      organizationId: parsed.data.organizationId,
      stallId: parsed.data.stallId ?? undefined,
      actorProfileId: authorization.principal.user.id,
      action: "PAYMENT_MOCK_CONNECTION_CONFIGURED",
      entityType: "PAYMENT_PROVIDER_CONNECTION",
      entityId: connection.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: {
        provider: parsed.data.provider,
        environment: "MOCK",
        enabledChannels: parsed.data.enabledChannels.join(","),
      },
    });
    return NextResponse.json(
      {
        connection: {
          id: connection.id,
          provider: connection.provider,
          environment: connection.environment,
          status: connection.status,
          enabledChannels: connection.enabledChannels,
          secretReferencePresent: Boolean(connection.secretReference),
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "PAYMENT_CONNECTION_UNAVAILABLE";
    const safe = code === "PAYMENT_MOCK_FORBIDDEN" || code === "PAYMENT_MOCK_MODE_REQUIRED"
      ? code
      : "PAYMENT_CONNECTION_UNAVAILABLE";
    return NextResponse.json(
      { error: safe },
      { status: 503, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
