import type { QrLocale } from "@/lib/qr-order-i18n";

type DeliveryOrderMessages = {
  delivery: string;
  phone: string;
  phonePlaceholder: string;
  address: string;
  addressPlaceholder: string;
  detailsRequired: string;
  unavailable: string;
  modeConflict: string;
  noticeTitle: string;
  noticeDismiss: string;
};

export const deliveryOrderMessages: Record<QrLocale, DeliveryOrderMessages> = {
  "zh-TW": {
    delivery: "外送",
    phone: "聯絡電話",
    phonePlaceholder: "請輸入可聯絡的電話",
    address: "外送地址",
    addressPlaceholder: "請輸入完整地址、門牌與樓層",
    detailsRequired: "請填寫有效的聯絡電話與外送地址。",
    unavailable: "目前未開放線上外送，請稍後再試或聯絡店家。",
    modeConflict: "此點餐連結的訂購方式不相符，請重新開啟 LINE 外送連結。",
    noticeTitle: "外送前請先確認",
    noticeDismiss: "我知道了，繼續點餐",
  },
  en: {
    delivery: "Delivery",
    phone: "Contact phone",
    phonePlaceholder: "Enter a reachable phone number",
    address: "Delivery address",
    addressPlaceholder: "Enter the full address, unit, and floor",
    detailsRequired: "Enter a valid contact phone number and delivery address.",
    unavailable: "Online delivery is currently unavailable. Please try again later or contact the store.",
    modeConflict: "This ordering link does not match the delivery mode. Reopen the LINE delivery link.",
    noticeTitle: "Before ordering delivery",
    noticeDismiss: "Got it — continue",
  },
  ja: {
    delivery: "配達",
    phone: "連絡先電話番号",
    phonePlaceholder: "連絡可能な電話番号を入力",
    address: "お届け先住所",
    addressPlaceholder: "住所、番地、建物名、階数を入力",
    detailsRequired: "有効な電話番号とお届け先住所を入力してください。",
    unavailable: "現在オンライン配達はご利用いただけません。時間をおいて再度お試しいただくか、店舗へお問い合わせください。",
    modeConflict: "注文方法が配達リンクと一致しません。LINE の配達リンクを開き直してください。",
    noticeTitle: "配達注文前のご案内",
    noticeDismiss: "確認して注文を続ける",
  },
  ko: {
    delivery: "배달",
    phone: "연락처",
    phonePlaceholder: "연락 가능한 전화번호 입력",
    address: "배달 주소",
    addressPlaceholder: "상세 주소와 층수를 입력",
    detailsRequired: "올바른 연락처와 배달 주소를 입력해 주세요.",
    unavailable: "현재 온라인 배달을 이용할 수 없습니다. 잠시 후 다시 시도하거나 매장에 문의해 주세요.",
    modeConflict: "주문 방식이 배달 링크와 일치하지 않습니다. LINE 배달 링크를 다시 열어 주세요.",
    noticeTitle: "배달 주문 전 안내",
    noticeDismiss: "확인하고 계속 주문",
  },
  vi: {
    delivery: "Giao hàng",
    phone: "Số điện thoại liên hệ",
    phonePlaceholder: "Nhập số điện thoại có thể liên hệ",
    address: "Địa chỉ giao hàng",
    addressPlaceholder: "Nhập đầy đủ địa chỉ, số nhà và tầng",
    detailsRequired: "Vui lòng nhập số điện thoại liên hệ và địa chỉ giao hàng hợp lệ.",
    unavailable: "Dịch vụ giao hàng trực tuyến hiện chưa khả dụng. Vui lòng thử lại sau hoặc liên hệ cửa hàng.",
    modeConflict: "Hình thức đặt món không khớp với liên kết giao hàng. Vui lòng mở lại liên kết giao hàng trên LINE.",
    noticeTitle: "Lưu ý trước khi đặt giao hàng",
    noticeDismiss: "Đã hiểu — tiếp tục",
  },
  th: {
    delivery: "จัดส่ง",
    phone: "หมายเลขโทรศัพท์ติดต่อ",
    phonePlaceholder: "กรอกหมายเลขโทรศัพท์ที่ติดต่อได้",
    address: "ที่อยู่จัดส่ง",
    addressPlaceholder: "กรอกที่อยู่ เลขที่ และชั้นให้ครบถ้วน",
    detailsRequired: "กรุณากรอกหมายเลขโทรศัพท์และที่อยู่จัดส่งที่ถูกต้อง",
    unavailable: "ขณะนี้ยังไม่เปิดให้บริการจัดส่งออนไลน์ โปรดลองอีกครั้งภายหลังหรือติดต่อร้านค้า",
    modeConflict: "รูปแบบคำสั่งซื้อไม่ตรงกับลิงก์จัดส่ง กรุณาเปิดลิงก์จัดส่งจาก LINE อีกครั้ง",
    noticeTitle: "โปรดอ่านก่อนสั่งจัดส่ง",
    noticeDismiss: "รับทราบ — สั่งต่อ",
  },
};

export function localizedDeliveryOrderError(locale: QrLocale, code: string) {
  if (code === "DELIVERY_UNAVAILABLE") return deliveryOrderMessages[locale].unavailable;
  if (code === "INVALID_DELIVERY_DETAILS") return deliveryOrderMessages[locale].detailsRequired;
  if (code === "ORDER_MODE_CONFLICT") return deliveryOrderMessages[locale].modeConflict;
  return null;
}
