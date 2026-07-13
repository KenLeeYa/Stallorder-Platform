import "server-only";

import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { hashClientIp } from "@/lib/security";

export async function authorizeCatalogMutation(
  request: Request,
  stallSlug: string,
  entityType: "PRODUCT" | "PRODUCT_CATEGORY",
  entityId?: string,
) {
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_PRODUCTS");
  if (!authorization.ok) return authorization;

  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      action: "CSRF_VALIDATION_FAILED",
      entityType,
      entityId,
      outcome: "DENIED",
      requestId: authorization.requestId,
      stallId: authorization.stall.id,
      actorProfileId: authorization.principal.user.id,
      ipHash: hashClientIp(request),
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "安全驗證已失效，請重新整理頁面後再試。" },
        { status: 403, headers: { "x-request-id": authorization.requestId } },
      ),
    };
  }

  return authorization;
}
