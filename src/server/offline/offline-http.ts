import "server-only";

import { NextResponse } from "next/server";
import { OfflineOperationError } from "@/server/offline/offline-device-service";

const messages: Record<string, { status: number; message: string }> = {
  OFFLINE_POS_DISABLED: {
    status: 403,
    message: "此攤位尚未開放離線點餐。",
  },
  OFFLINE_SINGLE_DEVICE_POLICY_DISABLED: {
    status: 403,
    message: "離線單一裝置安全政策尚未啟用。",
  },
  OFFLINE_DEVICE_SCOPE_MISMATCH: {
    status: 404,
    message: "找不到可使用的裝置登記。",
  },
  OFFLINE_DEVICE_NOT_FOUND: {
    status: 404,
    message: "找不到指定裝置。",
  },
  OFFLINE_DEVICE_REQUIRES_MANAGER_REVIEW: {
    status: 409,
    message: "此裝置已停用或撤銷，需由管理者重新檢查。",
  },
  OFFLINE_DEVICE_NOT_LEADER: {
    status: 403,
    message: "此裝置不是目前核准的離線 Leader。",
  },
  OFFLINE_POLICY_NOT_ACTIVE: {
    status: 409,
    message: "攤位離線政策尚未啟用。",
  },
  OFFLINE_STORAGE_READ_ONLY: {
    status: 409,
    message: "目前瀏覽器儲存空間不足或不可用，只能使用離線唯讀模式。",
  },
  OFFLINE_ROLE_NOT_ALLOWED: {
    status: 403,
    message: "目前角色不可建立離線訂單。",
  },
  OFFLINE_STALL_NOT_AVAILABLE: {
    status: 409,
    message: "攤位目前無法建立離線菜單快照。",
  },
  BACKEND_NOT_WRITABLE: {
    status: 503,
    message: "後端目前不可安全發行離線許可，請稍後再試。",
  },
  OFFLINE_PERMIT_SIGNING_SECRET_REQUIRED: {
    status: 503,
    message: "離線許可服務尚未完成設定。",
  },
  OFFLINE_PERMIT_SIGNING_SECRET_INVALID: {
    status: 503,
    message: "離線許可服務設定不完整。",
  },
  PRIMARY_STORAGE_NOT_CONFIGURED: {
    status: 503,
    message: "離線菜單儲存服務尚未完成設定。",
  },
  SOURCE_OBJECT_TOO_LARGE: {
    status: 503,
    message: "離線菜單資料超過安全容量上限。",
  },
  SOURCE_DOWNLOAD_FAILED: {
    status: 503,
    message: "目前無法確認離線菜單快照，請稍後再試。",
  },
  IMMUTABLE_OBJECT_COLLISION: {
    status: 503,
    message: "離線菜單快照一致性檢查失敗。",
  },
  OFFLINE_MENU_PUBLICATION_CHECKSUM_MISMATCH: {
    status: 503,
    message: "離線菜單快照完整性檢查失敗。",
  },
};

export function offlineErrorResponse(error: unknown, requestId: string) {
  const code = error instanceof OfflineOperationError || error instanceof Error
    ? error.message
    : "";
  const known = messages[code];
  if (!known) return null;
  return NextResponse.json(
    { error: known.message, code },
    {
      status: known.status,
      headers: {
        "cache-control": "private, no-store",
        "x-request-id": requestId,
      },
    },
  );
}

export function offlineNoStoreHeaders(requestId: string) {
  return {
    "cache-control": "private, no-store",
    "x-request-id": requestId,
  };
}
