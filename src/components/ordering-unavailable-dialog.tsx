"use client";

import { useState } from "react";
import type { AppLocale } from "@/lib/app-locale";
import { PublicOrderFeedbackDialog } from "@/components/public-order-feedback-dialog";

const messages = {
  "zh-TW": { updating: "點餐系統更新中", unavailable: "目前暫時無法送出訂單", message: "點餐服務正在更新或暫時無法連線。購物車內容已保留，服務恢復後可繼續送出。", retry: "重新檢查", browse: "先瀏覽菜單" },
  en: { updating: "Ordering system update", unavailable: "Ordering is temporarily unavailable", message: "Ordering is being updated or cannot be reached. Your cart is saved. You can submit once service resumes.", retry: "Check again", browse: "Browse menu" },
  ja: { updating: "注文システム更新中", unavailable: "現在、注文を送信できません", message: "更新中または一時的に接続できません。カートは保存されています。復旧後に送信できます。", retry: "再確認", browse: "メニューを見る" },
  ko: { updating: "주문 시스템 업데이트 중", unavailable: "현재 주문을 전송할 수 없어요", message: "업데이트 중이거나 일시적으로 연결할 수 없습니다. 장바구니는 저장되며 서비스 복구 후 주문할 수 있습니다.", retry: "다시 확인", browse: "메뉴 보기" },
  vi: { updating: "Hệ thống đang cập nhật", unavailable: "Tạm thời chưa thể gửi đơn", message: "Dịch vụ đang cập nhật hoặc tạm thời mất kết nối. Giỏ hàng đã được lưu. Bạn có thể gửi khi dịch vụ hoạt động lại.", retry: "Kiểm tra lại", browse: "Xem thực đơn" },
  th: { updating: "ระบบสั่งอาหารกำลังอัปเดต", unavailable: "ยังไม่สามารถส่งคำสั่งซื้อได้", message: "ระบบกำลังอัปเดตหรือเชื่อมต่อไม่ได้ชั่วคราว ตะกร้าของคุณถูกบันทึกแล้ว สามารถส่งได้เมื่อระบบกลับมาใช้งาน", retry: "ตรวจสอบอีกครั้ง", browse: "ดูเมนูก่อน" },
} as const;

export function OrderingUnavailableDialog({ locale, maintenance, busy, onRetry }: {
  locale: AppLocale; maintenance: boolean; busy: boolean; onRetry: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const copy = messages[locale];
  return <PublicOrderFeedbackDialog title={maintenance ? copy.updating : copy.unavailable}
    message={copy.message} primaryLabel={copy.retry} onPrimary={onRetry} busy={busy}
    secondaryLabel={copy.browse} onSecondary={() => setDismissed(true)} />;
}
