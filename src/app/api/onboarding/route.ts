import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { merchantApplicationCommandSchema } from "@/lib/merchant-application-contract";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, isTrustedOrigin } from "@/lib/security";
import { hashApplicationIdentifier } from "@/server/merchant-applications/application-identifiers";
import {
  getApplicantApplication,
  MerchantApplicationError,
  saveMerchantApplicationDraft,
  submitMerchantApplication,
  withdrawMerchantApplication,
} from "@/server/merchant-applications/merchant-application-service";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  if (!principal?.user.authUserId) {
    return NextResponse.json(
      { error: "請先使用已驗證的 Google 帳號登入。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  const requestUrl = new URL(request.url);
  const slug = requestUrl.searchParams.get("slug")?.trim().toLowerCase();
  if (slug !== undefined) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
      return NextResponse.json(
        { available: false, error: "網址代稱格式不正確。" },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }
    const [stall, application] = await Promise.all([
      prisma.stall.count({ where: { slug } }),
      prisma.merchantApplication.count({
        where: {
          requestedSlug: slug,
          applicantProfileId: { not: principal.user.id },
          status: { in: ["SUBMITTED", "PENDING_REVIEW", "NEEDS_INFO", "APPROVED"] },
        },
      }),
    ]);
    return NextResponse.json(
      { available: stall === 0 && application === 0 },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }

  const now = new Date();
  const [application, trialVersion, organizationAccess, stallAccess, pendingInvitation] = await Promise.all([
    getApplicantApplication(principal.user.id),
    prisma.planVersion.findFirst({
      where: {
        plan: { code: "TRIAL", isActive: true },
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
      },
      orderBy: { version: "desc" },
      select: {
        id: true,
        displayName: true,
        trialDays: true,
        maxStalls: true,
        maxStaff: true,
        maxProducts: true,
        maxQrCodes: true,
        includedOrders: true,
        overagePolicy: true,
      },
    }),
    prisma.organizationMembership.count({ where: { profileId: principal.user.id, isActive: true } }),
    prisma.stallMembership.count({ where: { profileId: principal.user.id, isActive: true } }),
    prisma.organizationInvitation.count({
      where: { email: principal.user.email, status: "PENDING", expiresAt: { gt: now } },
    }),
  ]);

  return NextResponse.json(
    {
      application,
      trial: trialVersion,
      alreadyOnboarded: organizationAccess > 0 || stallAccess > 0,
      pendingInvitation: pendingInvitation > 0,
    },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const principal = await getRequestPrincipal(request);
  let ipHash: string;
  try {
    ipHash = hashClientIp(request);
  } catch {
    return NextResponse.json(
      { error: "目前無法驗證連線來源。" },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }

  if (!isTrustedOrigin(request)) {
    return NextResponse.json(
      { error: "無法驗證申請來源。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }
  if (!principal?.user.authUserId) {
    return NextResponse.json(
      { error: "請先使用已驗證的 Google 帳號登入。" },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }
  if (!validateCsrf(request, principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": requestId } },
    );
  }

  const baseLimit = await checkRateLimit({
    scope: "merchant-application-api",
    identifier: principal.user.id,
    limit: 60,
    windowMs: 60 * 60_000,
  });
  if (!baseLimit.allowed) return rateLimitResponse(baseLimit.retryAfterSeconds, requestId);

  const body = await readJson(request, requestId);
  if (body.error) return body.error;
  const parsed = merchantApplicationCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "申請資料格式不正確。" },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  if (parsed.data.intent === "SUBMIT") {
    const emailHash = hashApplicationIdentifier("email", principal.user.email);
    const [profileLimit, emailLimit, ipHourLimit, ipDayLimit, sessionLimit] = await Promise.all([
      checkRateLimit({
        scope: "merchant-application-submit-profile-30d",
        identifier: principal.user.id,
        limit: 3,
        windowMs: 30 * 24 * 60 * 60_000,
      }),
      checkRateLimit({
        scope: "merchant-application-submit-email-30d",
        identifier: emailHash,
        limit: 3,
        windowMs: 30 * 24 * 60 * 60_000,
      }),
      checkRateLimit({
        scope: "merchant-application-submit-ip-hour",
        identifier: ipHash,
        limit: 5,
        windowMs: 60 * 60_000,
      }),
      checkRateLimit({
        scope: "merchant-application-submit-ip-day",
        identifier: ipHash,
        limit: 10,
        windowMs: 24 * 60 * 60_000,
      }),
      checkRateLimit({
        scope: "merchant-application-submit-session-day",
        identifier: principal.sessionId,
        limit: 5,
        windowMs: 24 * 60 * 60_000,
      }),
    ]);
    const limited = [profileLimit, emailLimit, ipHourLimit, ipDayLimit, sessionLimit]
      .find((result) => !result.allowed);
    if (limited) {
      await recordAuditEvent({
        action: "RATE_LIMIT_HIT",
        entityType: "MERCHANT_APPLICATION",
        outcome: "DENIED",
        requestId,
        actorProfileId: principal.user.id,
        ipHash,
        metadata: { scope: "merchant-application-submit" },
      });
      return rateLimitResponse(limited.retryAfterSeconds, requestId);
    }
  }

  const identity = {
    profileId: principal.user.id,
    authUserId: principal.user.authUserId,
    email: principal.user.email,
    displayName: principal.user.displayName,
    sessionId: principal.sessionId,
  };
  try {
    const application = parsed.data.intent === "SAVE_DRAFT"
      ? await saveMerchantApplicationDraft({
          identity,
          currentStep: parsed.data.currentStep,
          data: parsed.data.data,
          audit: { requestId, ipHash },
        })
      : parsed.data.intent === "SUBMIT"
        ? await submitMerchantApplication({
            identity,
            data: parsed.data.data,
            audit: { requestId, ipHash },
          })
        : await withdrawMerchantApplication({
            identity,
            applicationId: parsed.data.applicationId,
            audit: { requestId, ipHash },
          });
    return NextResponse.json(
      {
        application,
        next: application.status === "DRAFT" ? "/onboarding" : "/onboarding/status",
      },
      {
        status: parsed.data.intent === "SUBMIT" ? 201 : 200,
        headers: { "cache-control": "no-store", "x-request-id": requestId },
      },
    );
  } catch (error) {
    const response = merchantApplicationErrorResponse(error, requestId);
    if (response) return response;
    await recordAuditEvent({
      action: "MERCHANT_APPLICATION_WRITE_FAILED",
      entityType: "MERCHANT_APPLICATION",
      outcome: "FAILURE",
      requestId,
      actorProfileId: principal.user.id,
      ipHash,
    });
    return NextResponse.json(
      { error: "目前無法儲存申請，請稍後再試。" },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}

function merchantApplicationErrorResponse(error: unknown, requestId: string) {
  if (error instanceof MerchantApplicationError) {
    const messages: Record<MerchantApplicationError["code"], { status: number; error: string; next?: string }> = {
      PROFILE_NOT_GOOGLE_LINKED: { status: 403, error: "商家申請必須使用已驗證的 Google 帳號。" },
      PROFILE_ALREADY_ONBOARDED: { status: 409, error: "此帳號已有組織或攤位權限。", next: "/select-organization" },
      INVITATION_PENDING: { status: 409, error: "此信箱已有待接受邀請，請先使用邀請連結加入工作區。" },
      APPLICATION_PENDING: { status: 409, error: "已有申請正在審核。", next: "/onboarding/status" },
      APPLICATION_NOT_EDITABLE: { status: 409, error: "目前狀態不可修改申請。" },
      APPLICATION_NOT_FOUND: { status: 404, error: "找不到申請。" },
      APPLICATION_SOURCE_BLOCKED: { status: 403, error: "此申請來源目前無法送出，請聯絡平台管理員。" },
      REAPPLICATION_NOT_ALLOWED: { status: 403, error: "目前無法重新申請，請聯絡平台管理員。" },
      PLAN_NOT_AVAILABLE: { status: 409, error: "所選方案目前無法申請，請重新整理。" },
      MERCHANT_APPLICATION_TRANSITION_INVALID: { status: 409, error: "申請狀態已變更，請重新整理。" },
    };
    const detail = messages[error.code];
    return NextResponse.json(detail, { status: detail.status, headers: { "x-request-id": requestId } });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json(
      { error: "已有相同申請或網址代稱，請重新整理後確認。" },
      { status: 409, headers: { "x-request-id": requestId } },
    );
  }
  return null;
}

function rateLimitResponse(retryAfterSeconds: number, requestId: string) {
  return NextResponse.json(
    { error: "申請操作次數過多，請稍後再試。" },
    {
      status: 429,
      headers: { "retry-after": String(retryAfterSeconds), "x-request-id": requestId },
    },
  );
}
