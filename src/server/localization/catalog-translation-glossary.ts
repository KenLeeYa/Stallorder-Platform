import type { TranslationLocale } from "@/lib/enabled-locales";

const glossary: Record<TranslationLocale, Readonly<Record<string, string>>> = {
  en: {
    "加購項目": "Add-on item",
    "取餐": "Pickup",
    "送達": "Delivery",
    "內用": "Dine in",
    "外帶自取": "Pickup",
    "預約取餐": "Scheduled pickup",
    "預約送達": "Scheduled delivery",
  },
  ja: {
    "加購項目": "アドオン項目",
    "取餐": "受取",
    "送達": "配達",
    "內用": "店内",
    "外帶自取": "持ち帰り",
    "預約取餐": "予約受取",
    "預約送達": "予約配達",
  },
  ko: {
    "加購項目": "추가 기능 항목",
    "取餐": "픽업",
    "送達": "배달",
    "內用": "매장",
    "外帶自取": "포장 픽업",
    "預約取餐": "예약 픽업",
    "預約送達": "예약 배달",
  },
  vi: {
    "加購項目": "Hạng mục bổ sung",
    "取餐": "Nhận món",
    "送達": "Giao",
    "內用": "Tại chỗ",
    "外帶自取": "Tự đến lấy",
    "預約取餐": "Nhận hẹn giờ",
    "預約送達": "Giao hẹn giờ",
  },
  th: {
    "加購項目": "รายการส่วนเสริม",
    "取餐": "รับอาหาร",
    "送達": "ส่ง",
    "內用": "ทานที่ร้าน",
    "外帶自取": "รับเอง",
    "預約取餐": "รับตามนัด",
    "預約送達": "ส่งตามนัด",
  },
};

export function getCatalogGlossaryTranslation(source: string, locale: TranslationLocale) {
  return glossary[locale][source.trim().normalize("NFKC")] ?? null;
}
