"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Smartphone, UserRound, X } from "lucide-react";
import type { QrLocale } from "@/lib/qr-order-i18n";

export const qrMembershipPreviewCopy: Record<QrLocale, {
  button: string;
  title: string;
  description: string;
  phone: string;
  line: string;
  unavailable: string;
  continueAsGuest: string;
  close: string;
}> = {
  "zh-TW": {
    button: "會員",
    title: "會員快速入口（本機預覽）",
    description: "訪客仍可直接點餐。手機或 LINE 身分驗證完成設定後，才會開放會員登入、點數與優惠券。",
    phone: "手機驗證登入",
    line: "LINE 會員登入",
    unavailable: "尚未設定",
    continueAsGuest: "繼續訪客點餐",
    close: "關閉會員入口",
  },
  en: {
    button: "Member",
    title: "Member quick entry (local preview)",
    description: "Guest ordering remains available. Member sign-in, points and coupons will open only after phone or LINE verification is configured.",
    phone: "Sign in by phone",
    line: "Sign in with LINE",
    unavailable: "Not configured",
    continueAsGuest: "Continue as guest",
    close: "Close member entry",
  },
  ja: {
    button: "会員",
    title: "会員クイック入口（ローカルプレビュー）",
    description: "ゲスト注文は引き続き利用できます。電話または LINE 認証の設定後に会員ログイン、ポイント、クーポンを有効にします。",
    phone: "電話番号でログイン",
    line: "LINE でログイン",
    unavailable: "未設定",
    continueAsGuest: "ゲストとして続ける",
    close: "会員入口を閉じる",
  },
  ko: {
    button: "회원",
    title: "회원 빠른 진입（로컬 미리보기）",
    description: "비회원 주문은 계속 사용할 수 있습니다. 휴대전화 또는 LINE 인증을 설정한 뒤 회원 로그인, 포인트 및 쿠폰을 엽니다.",
    phone: "휴대전화 로그인",
    line: "LINE 로그인",
    unavailable: "설정되지 않음",
    continueAsGuest: "비회원으로 계속",
    close: "회원 진입 닫기",
  },
  vi: {
    button: "Thành viên",
    title: "Truy cập thành viên nhanh (bản xem trước cục bộ)",
    description: "Khách vẫn có thể đặt món. Đăng nhập, điểm và phiếu giảm giá chỉ mở sau khi xác minh điện thoại hoặc LINE được cấu hình.",
    phone: "Đăng nhập bằng điện thoại",
    line: "Đăng nhập bằng LINE",
    unavailable: "Chưa cấu hình",
    continueAsGuest: "Tiếp tục với tư cách khách",
    close: "Đóng mục thành viên",
  },
  th: {
    button: "สมาชิก",
    title: "ทางเข้าสมาชิกด่วน (ตัวอย่างในเครื่อง)",
    description: "ลูกค้ายังสั่งแบบผู้เยี่ยมชมได้ การเข้าสู่ระบบ คะแนน และคูปองจะเปิดเมื่อกำหนดค่าการยืนยันโทรศัพท์หรือ LINE แล้ว",
    phone: "เข้าสู่ระบบด้วยโทรศัพท์",
    line: "เข้าสู่ระบบด้วย LINE",
    unavailable: "ยังไม่ได้ตั้งค่า",
    continueAsGuest: "สั่งต่อแบบผู้เยี่ยมชม",
    close: "ปิดทางเข้าสมาชิก",
  },
};

export function QrCustomerMembershipEntry({
  locale,
  preview,
}: {
  locale: QrLocale;
  preview: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = qrMembershipPreviewCopy[locale];

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!preview) return null;

  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={copy.button}
        title={copy.button}
        data-testid="qr-member-entry"
        onClick={() => setOpen(true)}
        className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-teal-800 hover:border-teal-600 hover:bg-teal-50"
      >
        <UserRound className="h-5 w-5" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-member-dialog-title"
            className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <header className="flex min-h-14 items-center justify-between gap-3 border-b border-stone-200 px-4 py-2">
              <h2 id="qr-member-dialog-title" className="text-base font-bold text-stone-950">{copy.title}</h2>
              <button ref={closeRef} type="button" aria-label={copy.close} title={copy.close} onClick={close} className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-3 p-4">
              <p className="text-sm leading-6 text-stone-700">{copy.description}</p>
              <button type="button" disabled className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 text-left text-sm font-semibold text-stone-500">
                <Smartphone className="h-5 w-5 shrink-0" />
                <span className="flex-1">{copy.phone}</span>
                <span className="text-xs font-medium">{copy.unavailable}</span>
              </button>
              <button type="button" disabled className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 text-left text-sm font-semibold text-stone-500">
                <MessageCircle className="h-5 w-5 shrink-0" />
                <span className="flex-1">{copy.line}</span>
                <span className="text-xs font-medium">{copy.unavailable}</span>
              </button>
              <button type="button" onClick={close} className="min-h-12 w-full rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-700">
                {copy.continueAsGuest}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
