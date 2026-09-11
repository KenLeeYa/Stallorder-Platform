// Keep the preference in the existing order-note contract so Staff, KDS, and receipt consumers receive it together.
const utensilsLine = "【免洗餐具：需要】";

export function readOrderUtensils(note: string) {
  return note === utensilsLine || note.startsWith(utensilsLine + "\n")
    ? { required: true, note: note.slice(utensilsLine.length).replace(/^\n/, "") }
    : { required: false, note };
}

export function writeOrderUtensils(note: string, required: boolean) {
  const body = readOrderUtensils(note).note;
  return required ? utensilsLine + (body ? "\n" + body : "") : body;
}

export const utensilsNoteOverhead = utensilsLine.length + 1;

export const utensilsMessages = {
  "zh-TW": { label: "需要免洗餐具", hint: "需要餐具請勾選，不需要則不勾選；需求會隨訂單一起送給店家。", tooLong: "備註太長，請縮短後再加入餐具需求。" },
  en: { label: "Include disposable utensils", hint: "Check if you need utensils; leave unchecked if not needed. Your choice is sent with the order.", tooLong: "Shorten the note to add your utensils request." },
  ja: { label: "使い捨ての食器・カトラリーが必要", hint: "必要な場合はチェックを入れてください。不要な場合はチェックを外してください。ご希望を店舗にお伝えします。", tooLong: "食器の希望を追加するには備考を短くしてください。" },
  ko: { label: "일회용 수저가 필요해요", hint: "필요하지 않으면 선택하지 마세요. 요청은 주문과 함께 매장에 전달됩니다.", tooLong: "수저 요청을 추가하려면 메모를 줄여 주세요." },
  vi: { label: "Cần dụng cụ ăn dùng một lần", hint: "Không chọn nếu không cần. Yêu cầu được gửi cùng đơn hàng.", tooLong: "Rút ngắn ghi chú để thêm yêu cầu dụng cụ ăn." },
  th: { label: "ต้องการช้อนส้อมแบบใช้ครั้งเดียว", hint: "ไม่ต้องเลือกหากไม่ต้องการ ระบบจะส่งคำขอพร้อมคำสั่งซื้อ", tooLong: "โปรดย่อหมายเหตุเพื่อเพิ่มคำขอช้อนส้อม" },
} as const;
