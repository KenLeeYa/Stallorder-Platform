import type { AppLocale } from "@/lib/app-locale";
import { createMessageCatalog, type MessageValues } from "@/lib/message-catalog";

const definitions = {
  "schedule.featureTitle": ["排程報表尚未開放", "Scheduled reports are not available", "定期レポートは利用できません", "예약 보고서를 사용할 수 없습니다", "Báo cáo theo lịch chưa khả dụng", "ยังไม่พร้อมใช้รายงานตามกำหนดเวลา"],
  "schedule.backToStalls": ["返回管理攤位", "Back to stall management", "店舗管理に戻る", "매장 관리로 돌아가기", "Quay lại quản lý quầy", "กลับไปจัดการร้าน"],
  "schedule.defaultName": ["每日銷售日報", "Daily sales report", "日次売上レポート", "일일 매출 보고서", "Báo cáo doanh số hằng ngày", "รายงานยอดขายรายวัน"],
  "schedule.eyebrow": ["自動報表", "Automated reports", "自動レポート", "자동 보고서", "Báo cáo tự động", "รายงานอัตโนมัติ"],
  "schedule.title": ["排程寄送", "Scheduled delivery", "定期配信", "예약 발송", "Gửi theo lịch", "การส่งตามกำหนดเวลา"],
  "schedule.description": ["自動寄送日報、週報及付款差異報告。", "Automatically send daily, weekly, and payment-variance reports.", "日報、週報、支払い差異レポートを自動送信します。", "일간, 주간 및 결제 차이 보고서를 자동으로 발송합니다.", "Tự động gửi báo cáo ngày, tuần và chênh lệch thanh toán.", "ส่งรายงานรายวัน รายสัปดาห์ และส่วนต่างการชำระเงินโดยอัตโนมัติ"],
  "schedule.new": ["新增排程", "New schedule", "スケジュールを追加", "일정 추가", "Thêm lịch", "เพิ่มกำหนดเวลา"],
  "schedule.delivery.configured": ["Email 服務已設定，測試與排程會寄送真實郵件。", "Email is configured. Tests and schedules will send real messages.", "メールが設定済みです。テストと定期配信は実際に送信されます。", "이메일이 설정되어 테스트와 예약 발송이 실제로 전송됩니다.", "Email đã được cấu hình; bản thử và lịch sẽ gửi thư thật.", "ตั้งค่าอีเมลแล้ว การทดสอบและกำหนดเวลาจะส่งอีเมลจริง"],
  "schedule.delivery.simulated": ["目前為本機模擬模式：會產生完整報告與寄送紀錄，但不寄出郵件。", "Local simulation mode: reports and delivery records are created, but no email is sent.", "ローカル模擬モードです。レポートと配信履歴は作成されますが、メールは送信されません。", "로컬 시뮬레이션 모드입니다. 보고서와 발송 기록은 생성되지만 이메일은 보내지 않습니다.", "Chế độ mô phỏng cục bộ: tạo báo cáo và lịch sử gửi nhưng không gửi email.", "โหมดจำลองในเครื่อง: สร้างรายงานและประวัติการส่ง แต่ไม่ส่งอีเมล"],
  "schedule.delivery.missing": ["正式環境尚未設定 Email 服務，排程將明確記錄失敗。", "Email is not configured in production; scheduled deliveries will be recorded as failures.", "本番環境でメールが未設定のため、定期配信は失敗として記録されます。", "운영 환경에 이메일이 설정되지 않아 예약 발송이 실패로 기록됩니다.", "Email chưa được cấu hình ở môi trường chính thức; lịch gửi sẽ được ghi nhận thất bại.", "ยังไม่ได้ตั้งค่าอีเมลในระบบจริง การส่งตามกำหนดจะถูกบันทึกว่าล้มเหลว"],
  "schedule.existing": ["現有排程", "Existing schedules", "登録済みスケジュール", "기존 일정", "Lịch hiện có", "กำหนดเวลาที่มีอยู่"],
  "schedule.enabled": ["啟用中", "Enabled", "有効", "사용 중", "Đang bật", "เปิดใช้งาน"],
  "schedule.disabled": ["已停用", "Disabled", "無効", "사용 안 함", "Đã tắt", "ปิดใช้งาน"],
  "schedule.recipientCount": ["{count} 位收件人", "{count} recipients", "受信者 {count} 名", "수신자 {count}명", "{count} người nhận", "ผู้รับ {count} คน"],
  "schedule.nextRun": ["下次執行：{date}", "Next run: {date}", "次回実行：{date}", "다음 실행: {date}", "Lần chạy tiếp theo: {date}", "รันครั้งถัดไป: {date}"],
  "schedule.creator": ["建立者：{name}", "Created by: {name}", "作成者：{name}", "생성자: {name}", "Người tạo: {name}", "สร้างโดย: {name}"],
  "schedule.edit": ["編輯排程", "Edit schedule", "スケジュールを編集", "일정 편집", "Sửa lịch", "แก้ไขกำหนดเวลา"],
  "schedule.test": ["測試寄送", "Test delivery", "テスト送信", "테스트 발송", "Gửi thử", "ทดสอบการส่ง"],
  "schedule.archive": ["封存排程", "Archive schedule", "スケジュールをアーカイブ", "일정 보관", "Lưu trữ lịch", "เก็บกำหนดเวลา"],
  "schedule.recentDeliveries": ["最近寄送紀錄（{count}）", "Recent deliveries ({count})", "最近の配信（{count}）", "최근 발송 ({count})", "Lần gửi gần đây ({count})", "การส่งล่าสุด ({count})"],
  "schedule.delivery.processing": ["處理中", "Processing", "処理中", "처리 중", "Đang xử lý", "กำลังประมวลผล"],
  "schedule.delivery.sent": ["已寄送", "Sent", "送信済み", "발송됨", "Đã gửi", "ส่งแล้ว"],
  "schedule.delivery.simulatedStatus": ["模擬完成", "Simulation complete", "模擬完了", "시뮬레이션 완료", "Mô phỏng hoàn tất", "จำลองเสร็จสิ้น"],
  "schedule.delivery.failure": ["寄送失敗", "Delivery failed", "送信失敗", "발송 실패", "Gửi thất bại", "ส่งไม่สำเร็จ"],
  "schedule.deliveryPeriod": ["{start} 至 {end} · {count}", "{start} to {end} · {count}", "{start}～{end} · {count}", "{start}~{end} · {count}", "{start} đến {end} · {count}", "{start} ถึง {end} · {count}"],
  "schedule.noDeliveries": ["尚無寄送紀錄。", "No delivery records yet.", "配信履歴はまだありません。", "발송 기록이 없습니다.", "Chưa có lịch sử gửi.", "ยังไม่มีประวัติการส่ง"],
  "schedule.none": ["尚未建立報表寄送排程。", "No report-delivery schedule has been created.", "レポート配信スケジュールはまだありません。", "보고서 발송 일정이 없습니다.", "Chưa tạo lịch gửi báo cáo.", "ยังไม่ได้สร้างกำหนดการส่งรายงาน"],
  "schedule.editorTitle": ["排程設定", "Schedule settings", "スケジュール設定", "일정 설정", "Cài đặt lịch", "การตั้งค่ากำหนดเวลา"],
  "schedule.close": ["關閉", "Close", "閉じる", "닫기", "Đóng", "ปิด"],
  "schedule.name": ["排程名稱", "Schedule name", "スケジュール名", "일정 이름", "Tên lịch", "ชื่อกำหนดเวลา"],
  "schedule.reportType": ["報告類型", "Report type", "レポート種別", "보고서 유형", "Loại báo cáo", "ประเภทรายงาน"],
  "schedule.sendTime": ["寄送時間", "Send time", "送信時刻", "발송 시간", "Giờ gửi", "เวลาส่ง"],
  "schedule.weekday": ["寄送星期", "Send day", "送信曜日", "발송 요일", "Ngày gửi", "วันส่ง"],
  "schedule.select": ["請選擇", "Select", "選択してください", "선택", "Chọn", "เลือก"],
  "schedule.recipients": ["收件人 Email", "Recipient email", "受信者メール", "수신자 이메일", "Email người nhận", "อีเมลผู้รับ"],
  "schedule.recipientsPlaceholder": ["每行一個 Email，最多 20 位", "One email per line, up to 20", "1 行に 1 件、最大 20 件", "한 줄에 이메일 하나, 최대 20개", "Mỗi dòng một email, tối đa 20", "หนึ่งอีเมลต่อบรรทัด สูงสุด 20 รายการ"],
  "schedule.stalls": ["攤位範圍", "Stalls", "店舗範囲", "매장 범위", "Phạm vi quầy", "ขอบเขตร้าน"],
  "schedule.enable": ["啟用此排程", "Enable this schedule", "このスケジュールを有効にする", "이 일정 사용", "Bật lịch này", "เปิดใช้กำหนดเวลานี้"],
  "schedule.save": ["儲存排程", "Save schedule", "スケジュールを保存", "일정 저장", "Lưu lịch", "บันทึกกำหนดเวลา"],
  "schedule.cancel": ["取消", "Cancel", "キャンセル", "취소", "Hủy", "ยกเลิก"],
  "schedule.saved": ["報表排程已更新。", "The report schedule was updated.", "レポートスケジュールを更新しました。", "보고서 일정이 업데이트되었습니다.", "Đã cập nhật lịch báo cáo.", "อัปเดตกำหนดการรายงานแล้ว"],
  "schedule.created": ["報表排程已建立。", "The report schedule was created.", "レポートスケジュールを作成しました。", "보고서 일정이 생성되었습니다.", "Đã tạo lịch báo cáo.", "สร้างกำหนดการรายงานแล้ว"],
  "schedule.saveFailed": ["無法儲存報表排程。", "The report schedule could not be saved.", "レポートスケジュールを保存できませんでした。", "보고서 일정을 저장할 수 없습니다.", "Không thể lưu lịch báo cáo.", "ไม่สามารถบันทึกกำหนดการรายงานได้"],
  "schedule.confirmTest": ["確定立即測試寄送「{name}」？", "Send a test for “{name}” now?", "「{name}」を今すぐテスト送信しますか？", "“{name}” 테스트를 지금 발송할까요?", "Gửi thử “{name}” ngay bây giờ?", "ส่งการทดสอบ “{name}” ตอนนี้หรือไม่"],
  "schedule.confirmArchive": ["確定封存「{name}」？既有寄送紀錄會保留。", "Archive “{name}”? Existing delivery records will be kept.", "「{name}」をアーカイブしますか？既存の配信履歴は保持されます。", "“{name}” 일정을 보관할까요? 기존 발송 기록은 유지됩니다.", "Lưu trữ “{name}”? Lịch sử gửi hiện có sẽ được giữ lại.", "เก็บ “{name}” หรือไม่ ประวัติการส่งเดิมจะยังคงอยู่"],
  "schedule.testFailed": ["測試寄送失敗。", "Test delivery failed.", "テスト送信に失敗しました。", "테스트 발송에 실패했습니다.", "Gửi thử thất bại.", "การส่งทดสอบล้มเหลว"],
  "schedule.archiveFailed": ["無法封存排程。", "The schedule could not be archived.", "スケジュールをアーカイブできませんでした。", "일정을 보관할 수 없습니다.", "Không thể lưu trữ lịch.", "ไม่สามารถเก็บกำหนดเวลาได้"],
  "schedule.simulated": ["本機模擬寄送完成，未寄出真實 Email。", "Simulation complete; no real email was sent.", "ローカル模擬が完了しました。実際のメールは送信されていません。", "로컬 시뮬레이션이 완료되었으며 실제 이메일은 전송되지 않았습니다.", "Mô phỏng hoàn tất; không gửi email thật.", "จำลองเสร็จสิ้น โดยไม่ได้ส่งอีเมลจริง"],
  "schedule.testSent": ["測試報告已寄送。", "The test report was sent.", "テストレポートを送信しました。", "테스트 보고서가 발송되었습니다.", "Đã gửi báo cáo thử.", "ส่งรายงานทดสอบแล้ว"],
  "schedule.archived": ["排程已封存，寄送紀錄已保留。", "The schedule was archived and delivery records were kept.", "スケジュールをアーカイブし、配信履歴を保持しました。", "일정을 보관했으며 발송 기록은 유지됩니다.", "Đã lưu trữ lịch và giữ lại lịch sử gửi.", "เก็บกำหนดเวลาแล้วและยังคงประวัติการส่งไว้"],
  "schedule.operationFailed": ["操作失敗。", "The operation failed.", "操作に失敗しました。", "작업에 실패했습니다.", "Thao tác thất bại.", "การดำเนินการล้มเหลว"],
  "schedule.validationField": ["請檢查此欄位。", "Check this field.", "この項目を確認してください。", "이 항목을 확인하세요.", "Vui lòng kiểm tra trường này.", "โปรดตรวจสอบช่องนี้"],
  "schedule.type.daily": ["每日銷售日報", "Daily sales report", "日次売上レポート", "일일 매출 보고서", "Báo cáo doanh số hằng ngày", "รายงานยอดขายรายวัน"],
  "schedule.type.weekly": ["每週營運週報", "Weekly operations report", "週次運営レポート", "주간 운영 보고서", "Báo cáo vận hành hằng tuần", "รายงานการดำเนินงานรายสัปดาห์"],
  "schedule.type.variance": ["付款差異報告", "Payment variance report", "支払い差異レポート", "결제 차이 보고서", "Báo cáo chênh lệch thanh toán", "รายงานส่วนต่างการชำระเงิน"],
  "schedule.everyDay": ["每日 {time}", "Every day at {time}", "毎日 {time}", "매일 {time}", "Hằng ngày lúc {time}", "ทุกวันเวลา {time}"],
  "schedule.weeklyAt": ["{weekday} {time}", "{weekday} at {time}", "{weekday} {time}", "{weekday} {time}", "{weekday} lúc {time}", "{weekday} เวลา {time}"],
  "schedule.weekday.0": ["星期日", "Sunday", "日曜日", "일요일", "Chủ nhật", "วันอาทิตย์"],
  "schedule.weekday.1": ["星期一", "Monday", "月曜日", "월요일", "Thứ Hai", "วันจันทร์"],
  "schedule.weekday.2": ["星期二", "Tuesday", "火曜日", "화요일", "Thứ Ba", "วันอังคาร"],
  "schedule.weekday.3": ["星期三", "Wednesday", "水曜日", "수요일", "Thứ Tư", "วันพุธ"],
  "schedule.weekday.4": ["星期四", "Thursday", "木曜日", "목요일", "Thứ Năm", "วันพฤหัสบดี"],
  "schedule.weekday.5": ["星期五", "Friday", "金曜日", "금요일", "Thứ Sáu", "วันศุกร์"],
  "schedule.weekday.6": ["星期六", "Saturday", "土曜日", "토요일", "Thứ Bảy", "วันเสาร์"],
} as const satisfies Record<string, readonly [string, string, string, string, string, string]>;

export type ReportScheduleMessageKey = keyof typeof definitions;

function messagesFor(locale: AppLocale): Record<ReportScheduleMessageKey, string> {
  const index = { "zh-TW": 0, en: 1, ja: 2, ko: 3, vi: 4, th: 5 }[locale];
  return Object.fromEntries(Object.entries(definitions).map(([key, row]) => [key, row[index]])) as Record<ReportScheduleMessageKey, string>;
}

const catalog = createMessageCatalog(messagesFor("zh-TW"), {
  en: messagesFor("en"), ja: messagesFor("ja"), ko: messagesFor("ko"), vi: messagesFor("vi"), th: messagesFor("th"),
});

export function getReportScheduleMessage(locale: AppLocale, key: ReportScheduleMessageKey, values: MessageValues = {}) {
  return catalog.get(locale, key, values);
}

export function createReportScheduleTranslator(locale: AppLocale) {
  return (key: ReportScheduleMessageKey, values: MessageValues = {}) => getReportScheduleMessage(locale, key, values);
}

export type ReportScheduleTranslator = ReturnType<typeof createReportScheduleTranslator>;

export const reportScheduleMessages = catalog.messages;
