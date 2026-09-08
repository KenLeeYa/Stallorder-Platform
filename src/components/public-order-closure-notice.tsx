"use client";

import { useEffect, useState } from "react";
import type { AppLocale } from "@/lib/app-locale";
import { dateInTimeZone, localizeSpecialClosureTitle, type SpecialClosureView } from "@/lib/special-closures-client";
import { findOrderClosureNotice } from "@/lib/order-closure-notice";
import { PublicOrderFeedbackDialog } from "@/components/public-order-feedback-dialog";

const messages = {
  "zh-TW": { title: "取餐安排遇到店休公告", body: "店家的店休或特殊營業時間影響您的取餐安排。請聯絡店家確認或調整時間；目前訂單仍保留，未自動取消。", close: "我知道了", unavailable: "暫時無法取得最新店休公告，請稍後重新整理。" },
  en: { title: "Pickup overlaps a closure notice", body: "The store's closure or special hours affect your pickup arrangement. Contact the store to confirm or change the time. Your order is retained and has not been cancelled automatically.", close: "Got it", unavailable: "The latest closure notices are unavailable. Refresh shortly." },
  ja: { title: "受け取り予定と休業情報が重複しています", body: "店舗の休業日や特別営業時間が受け取り予定に影響します。店舗に確認・変更をご相談ください。注文は保持され、自動キャンセルされません。", close: "確認しました", unavailable: "最新の休業情報を取得できません。後ほど更新してください。" },
  ko: { title: "수령 일정이 휴무 공지와 겹쳐요", body: "매장의 휴무 또는 특별 영업시간이 수령 일정에 영향을 줍니다. 매장에 시간 확인이나 변경을 문의하세요. 주문은 유지되며 자동 취소되지 않습니다.", close: "확인했어요", unavailable: "최신 휴무 공지를 가져올 수 없습니다. 잠시 후 새로고침하세요." },
  vi: { title: "Lịch nhận món trùng thông báo nghỉ", body: "Ngày nghỉ hoặc giờ đặc biệt ảnh hưởng lịch nhận món. Vui lòng liên hệ cửa hàng để xác nhận hoặc đổi giờ. Đơn vẫn được giữ và chưa tự động hủy.", close: "Đã hiểu", unavailable: "Chưa thể tải thông báo nghỉ mới nhất. Vui lòng tải lại sau." },
  th: { title: "เวลารับอาหารตรงกับประกาศปิดร้าน", body: "วันหยุดหรือเวลาพิเศษของร้านมีผลต่อเวลารับอาหาร โปรดติดต่อร้านเพื่อยืนยันหรือเปลี่ยนเวลา คำสั่งซื้อยังคงอยู่และไม่ได้ถูกยกเลิกอัตโนมัติ", close: "รับทราบ", unavailable: "ยังโหลดประกาศวันหยุดล่าสุดไม่ได้ โปรดรีเฟรชภายหลัง" },
} as const;

export function PublicOrderClosureNotice({ identifier, fulfillmentAt, pendingAt, locale }: {
  identifier: string; fulfillmentAt: string | null; pendingAt: string | null; locale: AppLocale;
}) {
  const [data, setData] = useState<{ timezone: string; closures: SpecialClosureView[] } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    let stopped = false;
    let activeRequest: AbortController | null = null;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || activeRequest) return;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`/api/public/stores/${encodeURIComponent(identifier)}/closures`,
          { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("UNAVAILABLE");
        const payload = await response.json();
        if (!stopped) { setData(payload); setUnavailable(false); }
      } catch {
        if (!stopped) setUnavailable(true);
      } finally {
        window.clearTimeout(timeout);
        activeRequest = null;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisibility = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stopped = true; activeRequest?.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [identifier]);
  const copy = messages[locale];
  const notice = data ? findOrderClosureNotice(data.closures, data.timezone, [fulfillmentAt, pendingAt]) : null;
  if (!notice || !data) return unavailable ? <p role="status" className="mt-4 text-xs text-stone-600">{copy.unavailable}</p> : null;
  const { closure } = notice;
  const signature = JSON.stringify([closure, notice.fulfillmentAt]);
  const today = dateInTimeZone(new Date(), data.timezone);
  const onPickupDay = dateInTimeZone(new Date(notice.fulfillmentAt), data.timezone) === today;
  const detail = `${copy.body}\n${localizeSpecialClosureTitle(closure.title, locale)} · ${closure.startsOn}${closure.endsOn !== closure.startsOn ? ` – ${closure.endsOn}` : ""}${closure.message ? `\n${closure.message}` : ""}`;
  return <>
    <section role="alert" data-testid="order-closure-notice" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <h2 className="font-semibold">{copy.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{detail}</p>
    </section>
    {onPickupDay && dismissed !== signature ? <PublicOrderFeedbackDialog title={copy.title} message={detail}
      primaryLabel={copy.close} onPrimary={() => setDismissed(signature)} /> : null}
  </>;
}
