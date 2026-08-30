"use client";

import type { InvoiceBuyerSelection } from "@/lib/e-invoice-checkout-contract";
import { invoiceBuyerSelectionSchema } from "@/lib/e-invoice-checkout-contract";
import type { PublicMenu } from "@/lib/public-menu-types";
import type { QrLocale } from "@/lib/qr-order-i18n";

type Config = NonNullable<PublicMenu["invoiceCheckout"]>;

const copy = {
  "zh-TW": { title: "電子發票", test: "本機測試，非合法發票", cloud: "雲端發票", mobile: "手機條碼載具", member: "會員載具", business: "統編發票", donation: "捐贈", paper: "紙本證明聯", carrier: "載具號碼", taxId: "統一編號", buyerName: "公司抬頭", donationCode: "愛心碼", invalid: "請確認電子發票資料。" },
  en: { title: "E-invoice", test: "Local test only; not a legal invoice", cloud: "Cloud invoice", mobile: "Mobile barcode carrier", member: "Member carrier", business: "Business tax ID", donation: "Donation", paper: "Paper proof", carrier: "Carrier number", taxId: "Tax ID", buyerName: "Business name", donationCode: "Donation code", invalid: "Check the e-invoice details." },
  ja: { title: "電子インボイス", test: "ローカルテスト専用・法的な請求書ではありません", cloud: "クラウド発票", mobile: "携帯バーコード", member: "会員キャリア", business: "法人番号", donation: "寄付", paper: "紙の証明", carrier: "キャリア番号", taxId: "法人番号", buyerName: "会社名", donationCode: "寄付コード", invalid: "電子インボイス情報を確認してください。" },
  ko: { title: "전자 인보이스", test: "로컬 테스트 전용이며 법적 인보이스가 아닙니다", cloud: "클라우드 인보이스", mobile: "모바일 바코드", member: "회원 캐리어", business: "사업자 번호", donation: "기부", paper: "종이 증명", carrier: "캐리어 번호", taxId: "사업자 번호", buyerName: "회사명", donationCode: "기부 코드", invalid: "전자 인보이스 정보를 확인해 주세요." },
  vi: { title: "Hóa đơn điện tử", test: "Chỉ dùng thử cục bộ; không phải hóa đơn hợp pháp", cloud: "Hóa đơn đám mây", mobile: "Mã vạch di động", member: "Mã thành viên", business: "Mã số thuế", donation: "Quyên góp", paper: "Chứng từ giấy", carrier: "Mã lưu trữ", taxId: "Mã số thuế", buyerName: "Tên doanh nghiệp", donationCode: "Mã quyên góp", invalid: "Vui lòng kiểm tra thông tin hóa đơn điện tử." },
  th: { title: "ใบกำกับภาษีอิเล็กทรอนิกส์", test: "สำหรับทดสอบในเครื่องเท่านั้น ไม่ใช่ใบกำกับภาษีตามกฎหมาย", cloud: "ใบกำกับบนคลาวด์", mobile: "บาร์โค้ดมือถือ", member: "รหัสสมาชิก", business: "เลขประจำตัวผู้เสียภาษี", donation: "บริจาค", paper: "เอกสารกระดาษ", carrier: "หมายเลขตัวจัดเก็บ", taxId: "เลขประจำตัวผู้เสียภาษี", buyerName: "ชื่อบริษัท", donationCode: "รหัสบริจาค", invalid: "โปรดตรวจสอบข้อมูลใบกำกับภาษีอิเล็กทรอนิกส์" },
} satisfies Record<QrLocale, Record<string, string>>;

export function CheckoutInvoiceSelector({
  config,
  locale,
  value,
  disabled,
  onChange,
}: {
  config: Config;
  locale: QrLocale;
  value: InvoiceBuyerSelection;
  disabled: boolean;
  onChange: (value: InvoiceBuyerSelection) => void;
}) {
  const text = copy[locale];
  const options = [
    ["CLOUD", text.cloud, config.choices.cloud],
    ["MOBILE_BARCODE", text.mobile, config.choices.mobileBarcode],
    ["MEMBER_CARRIER", text.member, config.choices.memberCarrier],
    ["BUSINESS", text.business, config.choices.business],
    ["DONATION", text.donation, config.choices.donation],
    ["PAPER", text.paper, config.choices.paper],
  ] as const;

  return (
    <fieldset className="rounded-lg border border-stone-300 p-4" data-testid="checkout-invoice-selector">
      <legend className="px-1 font-semibold">{text.title}</legend>
      {config.testOnly ? <p className="mb-3 text-xs font-semibold text-amber-800">TEST / {text.test}</p> : null}
      <div className="grid gap-2">
        {options.filter(([, , enabled]) => enabled).map(([buyerType, label]) => (
          <label key={buyerType} className="flex min-h-10 items-center gap-3 rounded-md px-2 text-sm hover:bg-stone-50">
            <input
              type="radio"
              name="invoice-buyer-type"
              value={buyerType}
              checked={value.buyerType === buyerType}
              disabled={disabled}
              onChange={() => onChange(defaultSelection(buyerType))}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {value.buyerType === "MOBILE_BARCODE" || value.buyerType === "MEMBER_CARRIER" ? (
        <input
          type="text"
          autoComplete="off"
          aria-label={text.carrier}
          placeholder={value.buyerType === "MOBILE_BARCODE" ? "/XXXXXXX" : text.carrier}
          maxLength={value.buyerType === "MOBILE_BARCODE" ? 8 : 64}
          value={value.carrierValue}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, carrierValue: event.target.value })}
          className="form-input mt-3"
        />
      ) : null}
      {value.buyerType === "BUSINESS" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            inputMode="numeric"
            aria-label={text.taxId}
            placeholder={text.taxId}
            maxLength={8}
            value={value.buyerTaxId}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, buyerTaxId: event.target.value.replace(/\D/g, "") })}
            className="form-input"
          />
          <input
            type="text"
            aria-label={text.buyerName}
            placeholder={text.buyerName}
            maxLength={200}
            value={value.buyerName}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, buyerName: event.target.value })}
            className="form-input"
          />
        </div>
      ) : null}
      {value.buyerType === "DONATION" ? (
        <input
          type="text"
          inputMode="numeric"
          aria-label={text.donationCode}
          placeholder={text.donationCode}
          maxLength={7}
          value={value.donationCode}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, donationCode: event.target.value.replace(/\D/g, "") })}
          className="form-input mt-3"
        />
      ) : null}
      {!invoiceBuyerSelectionSchema.safeParse(value).success ? (
        <p className="mt-2 text-xs font-medium text-red-700">{text.invalid}</p>
      ) : null}
    </fieldset>
  );
}

export function invoiceBuyerSelectionIsValid(value: InvoiceBuyerSelection) {
  return invoiceBuyerSelectionSchema.safeParse(value).success;
}

export function defaultInvoiceBuyerSelection(config: Config): InvoiceBuyerSelection {
  if (config.choices.cloud) return { buyerType: "CLOUD" };
  if (config.choices.mobileBarcode) return defaultSelection("MOBILE_BARCODE");
  if (config.choices.memberCarrier) return defaultSelection("MEMBER_CARRIER");
  if (config.choices.business) return defaultSelection("BUSINESS");
  if (config.choices.donation) return defaultSelection("DONATION");
  return { buyerType: "PAPER" };
}

function defaultSelection(buyerType: InvoiceBuyerSelection["buyerType"]): InvoiceBuyerSelection {
  if (buyerType === "MOBILE_BARCODE" || buyerType === "MEMBER_CARRIER") return { buyerType, carrierValue: "" };
  if (buyerType === "BUSINESS") return { buyerType, buyerTaxId: "", buyerName: "" };
  if (buyerType === "DONATION") return { buyerType, donationCode: "" };
  return { buyerType };
}
