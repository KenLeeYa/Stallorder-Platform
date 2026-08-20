import { NextResponse } from "next/server";
import { DigitalWaitlistError } from "@/server/waitlist/digital-waitlist-service";

export function digitalWaitlistHeaders(requestId: string) {
  return {
    "cache-control": "private, no-store",
    "x-request-id": requestId,
  };
}

const messageByCode: Record<string, string> = {
  DIGITAL_WAITLIST_DISABLED: "目前未開放線上候位。",
  DIGITAL_WAITLIST_UNAVAILABLE: "線上候位暫時無法使用。",
  WAITLIST_STALL_NOT_FOUND: "找不到可候位的攤位。",
  WAITLIST_NOT_FOUND: "找不到候位資料。",
  WAITLIST_INVALID_INPUT: "候位資料格式不正確。",
  WAITLIST_ALREADY_ACTIVE: "此裝置已有進行中的候位。",
  WAITLIST_RATE_LIMITED: "候位操作過於頻繁，請稍後再試。",
  WAITLIST_VERSION_CONFLICT: "候位狀態已更新，請重新整理。",
  WAITLIST_TRANSITION_INVALID: "目前候位狀態不允許此操作。",
  WAITLIST_HOLD_ACTIVE: "保留時間尚未結束，不能標記為未到。",
  WAITLIST_SEATING_CONTRACT_INVALID: "入座資料不完整或餐桌不可用。",
  WAITLIST_SEATING_TOKEN_INVALID: "入座憑證無效。",
  WAITLIST_SEATING_TOKEN_USED: "入座憑證已使用。",
  WAITLIST_SEATING_TOKEN_EXPIRED: "入座憑證已過期。",
  WAITLIST_DINE_IN_QR_UNAVAILABLE: "餐桌點餐 QR Code 目前不可用。",
  WAITLIST_DINE_IN_UNAVAILABLE: "目前無法建立內用點餐連線。",
};

export function digitalWaitlistErrorResponse(error: unknown, requestId: string) {
  if (!(error instanceof DigitalWaitlistError)) throw error;
  return NextResponse.json(
    {
      error: messageByCode[error.code] ?? "線上候位暫時無法使用。",
      code: error.code,
    },
    {
      status: error.status,
      headers: {
        ...digitalWaitlistHeaders(requestId),
        ...(error.status === 429 ? { "retry-after": "600" } : {}),
      },
    },
  );
}
