import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, LogIn, QrCode, Store, Utensils } from "lucide-react";
import type { AppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { publicMessages } from "@/lib/messages/public";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";

export default async function Home() {
  const [{ locale }, billingState] = await Promise.all([
    getRequestAppLocale(),
    getBillingExperienceState(),
  ]);
  const billing = billingCopy[locale];
  const features = [
    ["homeQrTitle", "homeQrBody", QrCode],
    ["homeStaffTitle", "homeStaffBody", CheckCircle2],
    ["homePaymentTitle", "homePaymentBody", Utensils],
    ["homeReportTitle", "homeReportBody", BarChart3],
  ] as const;
  return (
    <main className="min-h-screen">
      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto grid min-h-[560px] max-w-6xl gap-10 px-5 py-8 md:grid-cols-[1.1fr_0.9fr] md:items-center md:px-8">
          <div>
            <div className="mb-6 flex items-center gap-3 text-sm font-semibold text-teal-800">
              <Store className="h-5 w-5" />
              StallOrder
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-normal text-stone-950 md:text-7xl">
              {publicMessages.get(locale, "homeTitle")}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
              {publicMessages.get(locale, "homeDescription")}
            </p>
            {billingState.openBetaFreeAccess ? <div className="mt-6 max-w-2xl rounded-md border border-teal-200 bg-teal-50 p-4"><strong className="text-teal-900">{billing.betaTitle}</strong><p className="mt-1 text-sm leading-6 text-teal-950">{billing.betaBody}</p></div> : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800"
              >
                {publicMessages.get(locale, "homeApply")}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-100"
              >
                {publicMessages.get(locale, "homeLogin")}
                <LogIn className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="grid gap-4">
            {features.map(([titleKey, bodyKey, Icon]) => (
              <div key={titleKey} className="rounded-lg border border-stone-200 bg-stone-50 p-5">
                <Icon className="mb-4 h-6 w-6 text-teal-700" />
                <h2 className="text-base font-semibold text-stone-950">{publicMessages.get(locale, titleKey)}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">{publicMessages.get(locale, bodyKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {billingState.merchantBillingVisible ? <section className="border-b border-stone-200 bg-stone-50"><div className="mx-auto max-w-6xl px-5 py-12 md:px-8"><p className="text-sm font-semibold text-teal-800">{billing.flow}</p><h2 className="mt-2 max-w-3xl text-3xl font-semibold text-stone-950">{billing.paygTitle}</h2><p className="mt-3 max-w-3xl leading-7 text-stone-600">{billing.paygBody}</p><div className="mt-6 grid gap-4 md:grid-cols-2"><article className="rounded-md border border-stone-200 bg-white p-5"><h3 className="font-semibold">StallOrder PAYG</h3><p className="mt-2 text-2xl font-semibold">TWD 1 <span className="text-sm font-normal text-stone-500">/ {billing.order}</span></p><p className="mt-2 text-sm text-stone-600">{billing.cap}</p></article><article className="rounded-md border border-stone-200 bg-white p-5"><h3 className="font-semibold">Enterprise</h3><p className="mt-2 text-sm leading-6 text-stone-600">{billing.enterprise}</p></article></div><p className="mt-5 text-sm text-stone-500">{billing.separateFees}</p></div></section> : null}

    </main>
  );
}

const billingCopy: Record<AppLocale, {
  betaTitle: string;
  betaBody: string;
  flow: string;
  paygTitle: string;
  paygBody: string;
  order: string;
  cap: string;
  enterprise: string;
  separateFees: string;
}> = {
  "zh-TW": { betaTitle: "開放測試期間免費使用", betaBody: "目前不收取平台費用；系統仍會記錄用量，但不會自動建立收費帳單。訂閱與付款功能尚未對商家開放。", flow: "14 天／100 筆試用 → StallOrder PAYG", paygTitle: "無月費、無買斷費，有完成訂單才計費。", paygBody: "每筆淨完成訂單 TWD 1，每個攤位每個計費月最高 TWD 1,499；多攤位各自封頂後加總。", order: "淨完成訂單", cap: "每個攤位每月最高 TWD 1,499", enterprise: "API、SSO、白標與客製整合由平台人工報價。", separateFees: "金流商手續費、外送、電子發票、訊息與外部加購服務另計，不包含在 TWD 1 平台費用內。" },
  en: { betaTitle: "Free during open beta", betaBody: "No platform fee is charged now. Usage is recorded, but no bill is closed automatically. Subscription and payment tools remain hidden from merchants.", flow: "14 days / 100 orders Trial → StallOrder PAYG", paygTitle: "No monthly fee or buyout fee. Pay only for completed orders.", paygBody: "TWD 1 per net completed order, capped at TWD 1,499 per stall per billing month. Multiple stalls are capped independently and then summed.", order: "net completed order", cap: "Maximum TWD 1,499 per stall each month", enterprise: "API, SSO, white label, and custom integrations are manually quoted.", separateFees: "Payment processing, delivery, e-invoice, messaging, and external add-on fees are separate from the TWD 1 platform fee." },
  ja: { betaTitle: "オープンベータ期間は無料", betaBody: "現在プラットフォーム料金は請求しません。利用量は記録されますが、自動で請求確定されず、契約・支払い機能は事業者に非表示です。", flow: "14日／100件トライアル → StallOrder PAYG", paygTitle: "月額・買い切り料金なし。完了注文のみ課金。", paygBody: "純完了注文1件につきTWD 1、店舗ごとに請求月最大TWD 1,499。複数店舗は個別に上限を適用して合算します。", order: "純完了注文", cap: "店舗ごとに月最大 TWD 1,499", enterprise: "API、SSO、ホワイトラベル、個別連携は手動見積です。", separateFees: "決済、配送、電子請求書、メッセージ、外部追加サービスの手数料は別途です。" },
  ko: { betaTitle: "오픈 베타 기간 무료", betaBody: "현재 플랫폼 요금은 부과하지 않습니다. 사용량은 기록하지만 자동 청구하지 않으며 구독·결제 기능은 매장에 숨겨집니다.", flow: "14일 / 100건 체험 → StallOrder PAYG", paygTitle: "월 요금과 구매 비용 없이 완료 주문만 과금합니다.", paygBody: "순 완료 주문당 TWD 1, 매장별 청구 월 최대 TWD 1,499입니다. 여러 매장은 각각 상한을 적용한 뒤 합산합니다.", order: "순 완료 주문", cap: "매장별 월 최대 TWD 1,499", enterprise: "API, SSO, 화이트 라벨 및 맞춤 연동은 별도 견적입니다.", separateFees: "결제 처리, 배달, 전자 청구서, 메시징 및 외부 부가 서비스 비용은 별도입니다." },
  vi: { betaTitle: "Miễn phí trong giai đoạn thử nghiệm mở", betaBody: "Hiện không thu phí nền tảng. Mức dùng vẫn được ghi nhận nhưng không tự động chốt hóa đơn; tính năng đăng ký và thanh toán được ẩn với cửa hàng.", flow: "Dùng thử 14 ngày / 100 đơn → StallOrder PAYG", paygTitle: "Không phí tháng hoặc phí mua đứt. Chỉ trả cho đơn hoàn tất.", paygBody: "TWD 1 mỗi đơn hoàn tất ròng, tối đa TWD 1.499 mỗi quầy trong một tháng tính phí. Nhiều quầy được áp trần riêng rồi cộng lại.", order: "đơn hoàn tất ròng", cap: "Tối đa TWD 1.499 mỗi quầy mỗi tháng", enterprise: "API, SSO, nhãn trắng và tích hợp riêng được báo giá thủ công.", separateFees: "Phí xử lý thanh toán, giao hàng, hóa đơn điện tử, tin nhắn và dịch vụ ngoài được tính riêng." },
  th: { betaTitle: "ใช้ฟรีในช่วงทดสอบแบบเปิด", betaBody: "ขณะนี้ไม่มีค่าธรรมเนียมแพลตฟอร์ม ระบบยังบันทึกการใช้งานแต่ไม่ปิดใบแจ้งหนี้อัตโนมัติ และซ่อนฟังก์ชันสมัครกับชำระเงินจากร้านค้า", flow: "ทดลอง 14 วัน / 100 ออเดอร์ → StallOrder PAYG", paygTitle: "ไม่มีค่ารายเดือนหรือค่าซื้อขาด จ่ายเฉพาะออเดอร์ที่เสร็จ", paygBody: "TWD 1 ต่อออเดอร์สุทธิที่เสร็จ สูงสุด TWD 1,499 ต่อร้านต่อรอบเดือน หลายร้านจะคำนวณเพดานแยกแล้วรวมยอด", order: "ออเดอร์สุทธิที่เสร็จ", cap: "สูงสุด TWD 1,499 ต่อร้านต่อเดือน", enterprise: "API, SSO, ไวท์เลเบล และการเชื่อมต่อเฉพาะเสนอราคาโดยผู้ดูแล", separateFees: "ค่าประมวลผลชำระเงิน จัดส่ง ใบกำกับอิเล็กทรอนิกส์ ข้อความ และบริการเสริมภายนอกคิดแยก" },
};
