import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import { catalogVersionCommandSchema } from "@/server/catalog-versions/catalog-version-command";
import {
  CatalogVersionOperationError,
  createCatalogDraft,
  listCatalogVersions,
  transitionCatalogVersion,
} from "@/server/catalog-versions/catalog-version-service";

type RouteContext = { params: Promise<{ organizationId: string }> };

function headers(requestId: string) {
  return { "cache-control": "no-store", "x-request-id": requestId };
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  try {
    return NextResponse.json(
      { versions: await listCatalogVersions(organizationId) },
      { headers: headers(authorization.requestId) },
    );
  } catch (error) {
    return catalogVersionErrorResponse(error, authorization.requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "CATALOG_MENU_VERSION",
      outcome: "DENIED",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
    });
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: headers(authorization.requestId) },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = catalogVersionCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "菜單版本資料不正確，請檢查標示欄位。",
        fieldErrors: getZodFieldErrors(parsed.error, {
          name: "版本名稱",
          menuKey: "菜單代碼",
          sourceVersionId: "來源版本",
          versionId: "版本",
          nextStatus: "下一狀態",
          scheduledPublishAt: "排程發布時間",
        }),
      },
      { status: 400, headers: headers(authorization.requestId) },
    );
  }

  try {
    const command = parsed.data;
    const result = command.operation === "CREATE_DRAFT"
      ? await createCatalogDraft({
        organizationId,
        profileId: authorization.principal.user.id,
        name: command.name,
        menuKey: command.menuKey,
        sourceVersionId: command.sourceVersionId,
      })
      : await transitionCatalogVersion({
        organizationId,
        profileId: authorization.principal.user.id,
        versionId: command.versionId,
        nextStatus: command.nextStatus,
        scheduledPublishAt: command.scheduledPublishAt
          ? new Date(command.scheduledPublishAt)
          : null,
      });

    await recordAuditEvent({
      organizationId,
      actorProfileId: authorization.principal.user.id,
      action: command.operation === "CREATE_DRAFT"
        ? "CATALOG_VERSION_DRAFT_CREATED"
        : "CATALOG_VERSION_STATUS_CHANGED",
      entityType: "CATALOG_MENU_VERSION",
      entityId: result.id,
      outcome: "SUCCESS",
      requestId: authorization.requestId,
      ipHash: hashClientIp(request),
      metadata: command.operation === "CREATE_DRAFT"
        ? { menuKey: command.menuKey, sourceVersionId: command.sourceVersionId }
        : { nextStatus: command.nextStatus },
    });
    return NextResponse.json(
      { versions: await listCatalogVersions(organizationId) },
      { headers: headers(authorization.requestId) },
    );
  } catch (error) {
    return catalogVersionErrorResponse(error, authorization.requestId);
  }
}

function catalogVersionErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof CatalogVersionOperationError
    ? error.code
    : error instanceof Error
      ? error.message
      : "CATALOG_VERSION_UPDATE_FAILED";
  const response = catalogVersionError(code);
  return NextResponse.json(
    { error: response.message },
    { status: response.status, headers: headers(requestId) },
  );
}

function catalogVersionError(code: string) {
  switch (code) {
    case "HQ_MODULE_DISABLED":
      return { status: 403, message: "總部菜單模組尚未對此組織開放。" };
    case "CATALOG_VERSION_NOT_FOUND":
    case "CATALOG_SOURCE_VERSION_NOT_FOUND":
      return { status: 404, message: "找不到指定的菜單版本。" };
    case "CATALOG_VERSION_TRANSITION_INVALID":
      return { status: 409, message: "此版本目前不能切換到指定狀態，請重新整理後再試。" };
    case "CATALOG_VERSION_SCHEDULE_REQUIRED":
      return { status: 400, message: "排程發布必須指定時間。" };
    default:
      return { status: 500, message: "目前無法更新菜單版本。" };
  }
}
