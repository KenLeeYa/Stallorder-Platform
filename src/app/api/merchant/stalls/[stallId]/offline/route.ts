import { NextResponse } from "next/server";
import { offlineManagementCommandSchema } from "@/offline/offline-contract";
import { authorizeStallManagementApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { getZodFieldErrors } from "@/lib/form-field-errors";
import { readJson } from "@/lib/http";
import { hashClientIp } from "@/lib/security";
import {
  applyOfflineManagementCommand,
  getOfflineManagementState,
  OfflineOperationError,
} from "@/server/offline/offline-device-service";
import { offlineErrorResponse, offlineNoStoreHeaders } from "@/server/offline/offline-http";

type RouteContext = { params: Promise<{ stallId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL",
  );
  if (!authorization.ok) return authorization.response;

  const data = await getOfflineManagementState(authorization.workspace.id, stallId);
  return NextResponse.json(data, {
    headers: offlineNoStoreHeaders(authorization.requestId),
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { stallId } = await context.params;
  const authorization = await authorizeStallManagementApiRequest(
    request,
    stallId,
    "MANAGE_STALL",
  );
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "CSRF 驗證失敗，請重新整理頁面後再試。" },
      { status: 403, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }

  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = offlineManagementCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors = getZodFieldErrors(parsed.error, {
      offlineEnabled: "離線收單",
      offlineLeaderDeviceId: "Leader 裝置",
      maxOfflineDurationMinutes: "最長離線時間",
      maxPendingOrders: "待同步訂單上限",
      maxTotalAmount: "離線累計金額上限",
      maxSingleOrderAmount: "單筆離線訂單上限",
      maxManualPaymentAmount: "單筆人工付款上限",
      maxTotalManualPaymentAmount: "人工付款累計上限",
      requireCustomerContactAboveAmount: "顧客聯絡資料門檻",
      managerApprovalThreshold: "經理核准門檻",
      reason: "異動原因",
    });
    return NextResponse.json(
      { error: Object.values(fieldErrors)[0] ?? "離線政策資料格式不正確。", fieldErrors },
      { status: 400, headers: offlineNoStoreHeaders(authorization.requestId) },
    );
  }

  try {
    const data = await applyOfflineManagementCommand({
      organizationId: authorization.workspace.id,
      stallId,
      command: parsed.data,
      actor: {
        profileId: authorization.principal.user.id,
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      },
    });
    return NextResponse.json(data, {
      headers: offlineNoStoreHeaders(authorization.requestId),
    });
  } catch (error) {
    if (
      parsed.data.operation === "UPDATE_POLICY"
      && error instanceof OfflineOperationError
      && ["OFFLINE_DEVICE_NOT_FOUND", "OFFLINE_DEVICE_REQUIRES_MANAGER_REVIEW"].includes(error.code)
    ) {
      return NextResponse.json(
        {
          error: "所選 Leader 裝置目前不可使用，請重新選擇。",
          fieldErrors: { offlineLeaderDeviceId: "所選 Leader 裝置目前不可使用，請重新選擇。" },
        },
        { status: 409, headers: offlineNoStoreHeaders(authorization.requestId) },
      );
    }
    const response = offlineErrorResponse(error, authorization.requestId);
    if (response) return response;
    throw error;
  }
}
