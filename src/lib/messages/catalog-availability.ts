import type { AppLocale } from "@/lib/app-locale";

const row = (zh: string, en: string, ja: string, ko: string, vi: string, th: string): Record<AppLocale, string> => ({ "zh-TW": zh, en, ja, ko, vi, th });

export const catalogAvailabilityMessages = {
  "availability.AVAILABLE": row("供應中", "Available", "提供中", "판매 중", "Đang bán", "พร้อมขาย"),
  "availability.TODAY": row("今日售完", "Sold out today", "本日売り切れ", "오늘 품절", "Hết hôm nay", "หมดวันนี้"),
  "availability.TEMPORARY": row("暫時停止供應", "Pause temporarily", "一時停止", "일시 판매 중지", "Tạm ngừng bán", "หยุดขายชั่วคราว"),
  "availability.UNTIL_DATE": row("指定日期恢復", "Resume on a date", "指定日に再開", "지정일에 재개", "Bán lại vào ngày", "ขายต่อในวันที่กำหนด"),
  "availability.PERMANENT": row("永久下架", "Delisted", "販売終了", "판매 종료", "Ngừng bán", "เลิกขาย"),
  "availability.paused": row("暫停供應", "Paused", "提供停止中", "판매 일시 중지", "Tạm dừng", "พักการขาย"),
  "availability.stockEmpty": row("庫存售完", "Out of stock", "在庫なし", "재고 없음", "Hết hàng", "สินค้าหมด"),
  "availability.help.AVAILABLE": row("立即解除暫停或下架。", "Remove the pause or delisting now.", "停止・販売終了を解除します。", "일시 중지 또는 판매 종료를 해제합니다.", "Bỏ tạm dừng hoặc ngừng bán ngay.", "ยกเลิกพักหรือเลิกขายทันที"),
  "availability.help.TODAY": row("下一個營業日開始時，自動恢復供應。", "Resume automatically at the next business day boundary.", "次の営業日の開始時に自動再開します。", "다음 영업일 시작 시 자동 재개됩니다.", "Tự bán lại khi bắt đầu ngày kinh doanh tiếp theo.", "ขายต่ออัตโนมัติเมื่อเริ่มวันทำการถัดไป"),
  "availability.help.TEMPORARY": row("補料或備餐後自動恢復。", "Resume automatically after the selected time.", "選択した時間後に自動再開します。", "선택한 시간이 지나면 자동 재개됩니다.", "Tự bán lại sau thời gian đã chọn.", "ขายต่ออัตโนมัติหลังเวลาที่เลือก"),
  "availability.help.UNTIL_DATE": row("所選日期的營業日開始時恢復供應。", "Resume at the business day boundary on the selected date.", "選択日の営業日開始時に再開します。", "선택한 날짜의 영업일 시작 시 재개됩니다.", "Bán lại khi bắt đầu ngày kinh doanh đã chọn.", "ขายต่อเมื่อเริ่มวันทำการในวันที่เลือก"),
  "availability.help.PERMANENT": row("從點餐菜單隱藏，需手動重新開放。", "Hide from ordering until manually restored.", "手動で再開するまで注文メニューに表示しません。", "수동으로 재개할 때까지 메뉴에서 숨깁니다.", "Ẩn khỏi thực đơn đến khi mở lại thủ công.", "ซ่อนจากเมนูจนกว่าจะเปิดขายอีกครั้ง"),
  "availability.title": row("設定供應狀態", "Set availability", "提供状況の設定", "판매 상태 설정", "Đặt trạng thái bán", "ตั้งค่าสถานะการขาย"),
  "availability.open": row("{name}：{status}，設定供應狀態", "{name}: {status}, set availability", "{name}：{status}、提供状況を設定", "{name}: {status}, 판매 상태 설정", "{name}: {status}, đặt trạng thái bán", "{name}: {status}, ตั้งค่าสถานะการขาย"),
  "availability.close": row("關閉供應狀態設定", "Close availability settings", "提供状況設定を閉じる", "판매 상태 설정 닫기", "Đóng cài đặt trạng thái bán", "ปิดการตั้งค่าสถานะการขาย"),
  "availability.selected": row("已選 {count} 項商品", "{count} products selected", "{count} 商品を選択中", "상품 {count}개 선택됨", "Đã chọn {count} sản phẩm", "เลือกสินค้า {count} รายการ"),
  "availability.minutes": row("{count} 分鐘", "{count} minutes", "{count} 分", "{count}분", "{count} phút", "{count} นาที"),
  "availability.hours": row("{count} 小時", "{count} hours", "{count} 時間", "{count}시간", "{count} giờ", "{count} ชั่วโมง"),
  "availability.date": row("恢復供應日期", "Resume date", "再開日", "판매 재개일", "Ngày bán lại", "วันที่ขายต่อ"),
  "availability.confirm": row("確認{status}", "Confirm: {status}", "{status}を確定", "확인: {status}", "Xác nhận: {status}", "ยืนยัน: {status}"),
  "availability.error": row("供應狀態暫時無法儲存，請稍後再試。", "Could not save availability. Please try again.", "提供状況を保存できません。再試行してください。", "판매 상태를 저장하지 못했습니다. 다시 시도하세요.", "Không lưu được trạng thái bán. Vui lòng thử lại.", "บันทึกสถานะการขายไม่ได้ โปรดลองอีกครั้ง"),
  "availability.connection": row("連線中斷，請確認目前供應狀態後再試。", "Connection lost. Check the current availability before retrying.", "接続が切れました。現在の提供状況を確認してから再試行してください。", "연결이 끊겼습니다. 현재 판매 상태를 확인한 후 다시 시도하세요.", "Mất kết nối. Kiểm tra trạng thái hiện tại trước khi thử lại.", "การเชื่อมต่อขาด โปรดตรวจสอบสถานะปัจจุบันก่อนลองใหม่"),
  "availability.constraints": row("以店家時區與營業日切換時間計算。恢復供應不會補回庫存；庫存為 0、主檔停用或不在供應排程的商品仍無法點餐。", "Uses the store timezone and business day boundary. Resuming does not restock: zero stock, inactive products or availability schedules still block ordering.", "店舗のタイムゾーンと営業日切替時刻を使用します。再開しても在庫は増えません。在庫ゼロ、商品無効、提供時間外は注文できません。", "매장 시간대와 영업일 기준으로 계산합니다. 재개해도 재고는 늘지 않습니다. 재고 없음, 비활성 상품 또는 판매 시간 외에는 주문할 수 없습니다.", "Theo múi giờ và mốc ngày kinh doanh của cửa hàng. Bán lại không bổ sung tồn kho; hàng hết, bị vô hiệu hoặc ngoài lịch bán vẫn không đặt được.", "ใช้เขตเวลาและเวลาเริ่มวันทำการของร้าน การขายต่อไม่เติมสต็อก สินค้าหมด ปิดใช้งาน หรือนอกเวลาขายยังสั่งไม่ได้"),
  "catalog.pageSelection": row("全選本頁（{count}）", "Select this page ({count})", "このページを選択（{count}）", "이 페이지 전체 선택 ({count})", "Chọn trang này ({count})", "เลือกหน้านี้ ({count})"),
  "catalog.previousPage": row("上一頁商品", "Previous products", "前の商品ページ", "이전 상품", "Sản phẩm trang trước", "สินค้าหน้าก่อน"),
  "catalog.nextPage": row("下一頁商品", "Next products", "次の商品ページ", "다음 상품", "Sản phẩm trang sau", "สินค้าหน้าถัดไป"),
} as const;
