import type { AppLocale } from "@/lib/app-locale";
const row = (zh: string, en: string, ja: string, ko: string, vi: string, th: string): Record<AppLocale, string> => ({ "zh-TW": zh, en, ja, ko, vi, th });
const messages = {
  search: row("搜尋商家名稱或編號", "Search merchant name or ID", "店舗名・IDを検索", "상호 또는 ID 검색", "Tìm tên hoặc mã cửa hàng", "ค้นหาชื่อหรือรหัสร้าน"),
  all: row("全部狀態", "All statuses", "すべての状態", "모든 상태", "Tất cả trạng thái", "ทุกสถานะ"),
  previous: row("上一頁", "Previous", "前へ", "이전", "Trước", "ก่อนหน้า"),
  next: row("下一頁", "Next", "次へ", "다음", "Sau", "ถัดไป"),
  definitions: row("資料範圍與計算方式", "Scope & definitions", "対象・定義", "범위 및 정의", "Phạm vi & định nghĩa", "ขอบเขตและวิธีคำนวณ"),
  refreshed: row("本次讀取時間", "Retrieved at", "取得時刻", "조회 시각", "Thời điểm đọc", "เวลาที่ดึงข้อมูล"),
  timezone: row("門市時區", "Store time zones", "店舗のタイムゾーン", "매장 시간대", "Múi giờ cửa hàng", "เขตเวลาร้าน"),
  hourly: row("各小時以門市當地完成時間歸類，只計已完成且非測試訂單。不同門市依各自營業日彙總。", "Hours use each store's local completion time. Only completed, non-test orders are included, by each store's business day.", "各店舗の現地完了時刻・営業日で集計し、完了した非テスト注文のみ含みます。", "매장의 현지 완료 시간과 영업일로 집계하며 완료된 비테스트 주문만 포함합니다.", "Giờ dựa trên thời điểm hoàn tất và ngày kinh doanh địa phương. Chỉ gồm đơn đã hoàn tất, không phải đơn thử.", "จัดตามเวลาที่เสร็จและวันทำการของแต่ละร้าน รวมเฉพาะออเดอร์จริงที่เสร็จแล้ว"),
  metrics: row("客單價＝營收÷完成訂單數；取消率＝取消訂單÷全部訂單。摘要與明細來源可能有同步延遲，零值不代表資料已完整。", "Average order = sales / completed orders; cancellation rate = cancelled / all orders. Summary and detail sources may lag; zero does not prove completeness.", "客単価＝売上÷完了件数、取消率＝取消件数÷全件数。集計・明細に同期遅延があり、ゼロは完全性を保証しません。", "객단가=매출/완료 주문, 취소율=취소/전체 주문. 요약과 상세 동기화가 지연될 수 있으며 0은 완전성을 보장하지 않습니다.", "Giá trị trung bình=doanh thu/đơn hoàn tất; tỷ lệ hủy=đơn hủy/tất cả đơn. Dữ liệu có thể trễ; số 0 không đảm bảo đầy đủ.", "ยอดเฉลี่ย=ยอดขาย/ออเดอร์เสร็จ อัตรายกเลิก=ยกเลิก/ทั้งหมด สรุปและรายละเอียดอาจล่าช้า ค่า 0 ไม่ยืนยันว่าข้อมูลครบ"),
  export: row("將匯出所選期間與攤位的資料。檔案可能含營運資訊，請只交付有權限的人員。", "Exports the selected dates and stores. The file may contain business information; share only with authorized people.", "選択期間・店舗を出力します。営業情報を含むため権限を持つ人にのみ共有してください。", "선택 기간과 매장을 내보냅니다. 영업 정보가 포함될 수 있으므로 권한 있는 사람에게만 공유하세요.", "Xuất ngày và cửa hàng đã chọn. Có thể chứa thông tin kinh doanh; chỉ chia sẻ với người có quyền.", "ส่งออกช่วงวันและร้านที่เลือก อาจมีข้อมูลธุรกิจ ให้เฉพาะผู้มีสิทธิ์เท่านั้น"),
} as const;
export const managementExperienceMessage = (locale: AppLocale, key: keyof typeof messages) => messages[key][locale];
