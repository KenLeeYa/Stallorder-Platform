import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent, logEvent } from "@/lib/audit";
import { authorizeOrganizationApiRequest } from "@/lib/authorization";
import { getOrganizationCatalog } from "@/lib/catalog-data";
import { validateCsrf } from "@/lib/csrf";
import { getEnabledTranslationLocales } from "@/lib/enabled-locales";
import { readJson } from "@/lib/http";
import { getOrganizationEnabledLocales } from "@/lib/localization-data";
import {
  getOrganizationProductNotes,
  getOrganizationReusableProductNotes,
} from "@/lib/product-note-data";
import { invalidatePublicMenus } from "@/lib/public-menu";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import {
  CatalogTranslationLimitError,
  CatalogTranslationSourceChangedError,
  translateMissingCatalogContent,
} from "@/server/localization/catalog-translation-service";
import {
  CatalogTranslationOutputError,
} from "@/server/localization/catalog-translation-contract";
import {
  CatalogTranslationConfigurationError,
  CatalogTranslationProviderError,
  isCatalogAiTranslationConfigured,
  OpenAiCatalogTranslationProvider,
  resolveCatalogAiTranslationRequestCredential,
} from "@/server/localization/openai-catalog-translation-provider";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ organizationId: string }> };

const requestSchema = z.object({
  mode: z.literal("MISSING_ONLY"),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  const { organizationId } = await context.params;
  const authorization = await authorizeOrganizationApiRequest(
    request,
    organizationId,
    "MANAGE_SHARED_PRODUCTS",
  );
  if (!authorization.ok) return authorization.response;
  const requestId = authorization.requestId;
  const actorProfileId = authorization.principal.user.id;
  const ipHash = hashClientIp(request);

  if (!validateCsrf(request, authorization.principal)) {
    await recordAuditEvent({
      organizationId,
      actorProfileId,
      action: "CSRF_VALIDATION_FAILED",
      entityType: "CATALOG_TRANSLATION",
      outcome: "DENIED",
      requestId,
      ipHash,
    });
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const body = await readJson(request, requestId);
  if (body.error) return body.error;
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "翻譯請求格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  const [actorLimit, organizationLimit] = await Promise.all([
    checkRateLimit({
      scope: "catalog-ai-translation-actor",
      identifier: `${organizationId}:${actorProfileId}`,
      limit: 3,
      windowMs: 10 * 60_000,
    }),
    checkRateLimit({
      scope: "catalog-ai-translation-organization",
      identifier: organizationId,
      limit: 10,
      windowMs: 60 * 60_000,
    }),
  ]);
  if (!actorLimit.allowed || !organizationLimit.allowed) {
    const retryAfterSeconds = Math.max(
      actorLimit.allowed ? 0 : actorLimit.retryAfterSeconds,
      organizationLimit.allowed ? 0 : organizationLimit.retryAfterSeconds,
    );
    await recordAuditEvent({
      organizationId,
      actorProfileId,
      action: "CATALOG_AI_TRANSLATION_RATE_LIMITED",
      entityType: "CATALOG_TRANSLATION",
      outcome: "DENIED",
      requestId,
      ipHash,
    });
    return NextResponse.json(
      { error: "AI 翻譯操作過於頻繁，請稍後再試。" },
      {
        status: 429,
        headers: {
          "retry-after": String(retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }

  const stallIds = authorization.workspace.stalls.map((stall) => stall.id);
  try {
    await entitlementService.assertSubscriptionUsable(organizationId);
    const aiRequestCredential = await resolveCatalogAiTranslationRequestCredential();
    if (!isCatalogAiTranslationConfigured(aiRequestCredential)) {
      throw new CatalogTranslationConfigurationError("AI 翻譯設定不完整。");
    }
    const enabledLocales = await getOrganizationEnabledLocales(organizationId, stallIds);
    const translationLocales = getEnabledTranslationLocales(enabledLocales);
    const summary = await translateMissingCatalogContent({
      organizationId,
      locales: translationLocales,
      provider: new OpenAiCatalogTranslationProvider(aiRequestCredential),
    });
    invalidatePublicMenus(stallIds);
    await recordAuditEvent({
      organizationId,
      actorProfileId,
      action: "CATALOG_AI_TRANSLATION_COMPLETED",
      entityType: "CATALOG_TRANSLATION",
      outcome: "SUCCESS",
      requestId,
      ipHash,
      metadata: {
        targetLocaleCount: summary.targetLocales.length,
        requestedTargetCount: summary.requestedTargets,
        translatedFieldCount: summary.translatedFields,
        translatedProductCount: summary.translatedProducts,
        translatedNoteGroupCount: summary.translatedNoteGroups,
        translatedNoteOptionCount: summary.translatedNoteOptions,
        translatedReusableNoteCount: summary.translatedReusableNotes,
      },
    });

    const [catalog, noteGroups, reusableNotes] = await Promise.all([
      getOrganizationCatalog(organizationId, stallIds),
      getOrganizationProductNotes(organizationId),
      getOrganizationReusableProductNotes(organizationId),
    ]);
    return NextResponse.json(
      { summary, catalog, noteGroups, reusableNotes },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, requestId);
    if (entitlementResponse) return entitlementResponse;

    const known = translationErrorResponse(error);
    const upstreamFailure = error instanceof CatalogTranslationProviderError
      ? error.upstreamFailure
      : undefined;
    logEvent(known.status >= 500 ? "error" : "warn", "CATALOG_AI_TRANSLATION_FAILED", {
      requestId,
      organizationId,
      actorProfileId,
      errorCode: known.code,
      ...(upstreamFailure ? { upstreamFailure } : {}),
    });
    await recordAuditEvent({
      organizationId,
      actorProfileId,
      action: "CATALOG_AI_TRANSLATION_FAILED",
      entityType: "CATALOG_TRANSLATION",
      outcome: "FAILURE",
      requestId,
      ipHash,
      metadata: {
        errorCode: known.code,
        ...(upstreamFailure ? { upstreamFailure } : {}),
      },
    });
    return NextResponse.json(
      { error: known.message },
      { status: known.status, headers: { "x-request-id": requestId } },
    );
  }
}

function translationErrorResponse(error: unknown) {
  if (error instanceof CatalogTranslationConfigurationError) {
    return {
      status: 503,
      code: error.code,
      message: "AI 翻譯服務尚未完成伺服器設定。",
    };
  }
  if (error instanceof CatalogTranslationLimitError) {
    return {
      status: 422,
      code: error.code,
      message: "待翻譯內容超過單次安全上限，請先停用不需翻譯的語系或聯絡平台管理員。",
    };
  }
  if (error instanceof CatalogTranslationSourceChangedError) {
    return {
      status: 409,
      code: error.code,
      message: "商品資料在翻譯期間已變更，請重新整理後再試。",
    };
  }
  if (error instanceof CatalogTranslationProviderError || error instanceof CatalogTranslationOutputError) {
    return {
      status: 502,
      code: error.code,
      message: "AI 翻譯暫時無法完成，既有商品資料未被修改。",
    };
  }
  return {
    status: 500,
    code: "AI_TRANSLATION_UNEXPECTED_ERROR",
    message: "目前無法完成 AI 翻譯，既有商品資料未被修改。",
  };
}
