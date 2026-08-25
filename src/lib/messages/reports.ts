import type { AppLocale } from "@/lib/app-locale";
import { createMessageCatalog, type MessageValues } from "@/lib/message-catalog";

type ReportMessageRow = readonly [string, string, string, string, string, string];

const reportDescriptionOverrides = {
  "reports.payments.description": ["依實際收款時間與方式統計；稍後結帳列在付款當日。", "Based on actual payment time and method. Pay-later orders appear on the payment date.", "実際の入金時刻と方法で集計し、後払いは入金日に計上します。", "실제 결제 시각과 방식으로 집계하며, 후결제는 결제일에 반영됩니다.", "Thống kê theo thời gian và cách thanh toán thực tế; đơn trả sau tính vào ngày thanh toán.", "สรุปตามเวลารับเงินจริงและวิธีชำระ โดยออเดอร์จ่ายภายหลังจะอยู่ในวันที่ชำระ"],
  "reports.stalls.description": ["比較各攤位的訂單、未付款與取消情況。", "Compare orders, unpaid orders, and cancellations by stall.", "店舗ごとの注文、未払い、キャンセルを比較します。", "매장별 주문, 미결제 및 취소 현황을 비교합니다.", "So sánh đơn, đơn chưa thanh toán và đơn hủy theo quầy.", "เปรียบเทียบออเดอร์ ค้างชำระ และการยกเลิกตามร้าน"],
  "reports.products.description": ["查看下單時的商品名稱與成交價格。", "View product names and final prices at the time of order.", "注文時の商品名と販売価格を確認します。", "주문 당시 상품명과 판매 가격을 확인합니다.", "Xem tên sản phẩm và giá bán tại thời điểm đặt đơn.", "ดูชื่อสินค้าและราคาขาย ณ เวลาสั่ง"],
  "reports.orders.description": ["依日期查看每張訂單的狀態與品項。", "View each order's status and items by date.", "日付別に各注文の状態と品目を確認します。", "날짜별로 각 주문의 상태와 품목을 확인합니다.", "Xem trạng thái và món của từng đơn theo ngày.", "ดูสถานะและรายการของแต่ละออเดอร์ตามวันที่"],
  "reports.cash.description": ["查看每個班次的現金收支與盤點差額。", "View cash movement and counted variance for each shift.", "各シフトの現金収支と実査差額を確認します。", "각 교대의 현금 입출금과 실사 차이를 확인합니다.", "Xem thu chi tiền mặt và chênh lệch kiểm đếm của từng ca.", "ดูเงินสดรับจ่ายและผลต่างการนับของแต่ละกะ"],
} as const satisfies Record<string, ReportMessageRow>;

const definitions = {
  "reports.eyebrow": ["跨攤位報表", "Cross-stall reports", "店舗横断レポート", "매장 통합 보고서", "Báo cáo nhiều quầy", "รายงานหลายร้าน"],
  "reports.nav": ["報表分類", "Report categories", "レポート分類", "보고서 분류", "Danh mục báo cáo", "หมวดหมู่รายงาน"],
  "reports.nav.overview": ["趨勢總覽", "Trends", "トレンド概要", "추세 개요", "Tổng quan xu hướng", "ภาพรวมแนวโน้ม"],
  "reports.nav.orders": ["所有訂單", "All orders", "すべての注文", "전체 주문", "Tất cả đơn hàng", "ออเดอร์ทั้งหมด"],
  "reports.nav.stalls": ["攤位比較", "Stall comparison", "店舗比較", "매장 비교", "So sánh quầy", "เปรียบเทียบร้าน"],
  "reports.nav.products": ["商品分析", "Product analysis", "商品分析", "상품 분석", "Phân tích sản phẩm", "วิเคราะห์สินค้า"],
  "reports.nav.payments": ["付款分析", "Payment analysis", "支払い分析", "결제 분석", "Phân tích thanh toán", "วิเคราะห์การชำระเงิน"],
  "reports.nav.cashShifts": ["現金交班", "Cash shifts", "現金シフト", "현금 교대", "Ca tiền mặt", "กะเงินสด"],
  "reports.filter.dateRange": ["日期區間", "Date range", "期間", "기간", "Khoảng ngày", "ช่วงวันที่"],
  "reports.filter.day": ["日", "Day", "日", "일", "Ngày", "วัน"],
  "reports.filter.week": ["週", "Week", "週", "주", "Tuần", "สัปดาห์"],
  "reports.filter.month": ["月", "Month", "月", "월", "Tháng", "เดือน"],
  "reports.filter.startDate": ["開始日期", "Start date", "開始日", "시작일", "Ngày bắt đầu", "วันที่เริ่มต้น"],
  "reports.filter.endDate": ["結束日期", "End date", "終了日", "종료일", "Ngày kết thúc", "วันที่สิ้นสุด"],
  "reports.filter.to": ["至", "to", "～", "~", "đến", "ถึง"],
  "reports.filter.stalls": ["攤位範圍", "Stalls", "店舗範囲", "매장 범위", "Phạm vi quầy", "ขอบเขตร้าน"],
  "reports.filter.apply": ["套用篩選", "Apply filters", "絞り込みを適用", "필터 적용", "Áp dụng bộ lọc", "ใช้ตัวกรอง"],
  "reports.export.progress": ["匯出中…", "Exporting…", "エクスポート中…", "내보내는 중…", "Đang xuất…", "กำลังส่งออก…"],
  "reports.export.action": ["匯出 CSV", "Export CSV", "CSV を出力", "CSV 내보내기", "Xuất CSV", "ส่งออก CSV"],
  "reports.export.error": ["目前無法匯出報表。", "The report cannot be exported right now.", "現在レポートを出力できません。", "현재 보고서를 내보낼 수 없습니다.", "Hiện không thể xuất báo cáo.", "ขณะนี้ไม่สามารถส่งออกรายงานได้"],
  "reports.count.orders": ["{count} 筆", "{count} orders", "{count} 件", "{count}건", "{count} đơn", "{count} ออเดอร์"],
  "reports.count.items": ["{count} 份", "{count} items", "{count} 点", "{count}개", "{count} phần", "{count} รายการ"],
  "reports.count.shifts": ["{count} 班", "{count} shifts", "{count} シフト", "{count}개 교대", "{count} ca", "{count} กะ"],
  "reports.overview.title": ["銷售趨勢總覽", "Order-entry trends", "注文登録トレンド", "주문 등록 추세", "Xu hướng ghi nhận đơn", "แนวโน้มยอดลงทะเบียนออเดอร์"],
  "reports.overview.summary": ["銷售摘要", "Order summary", "注文概要", "주문 요약", "Tóm tắt đơn", "สรุปออเดอร์"],
  "reports.orderEntryAmount": ["訂單登記額", "Order-entry amount", "注文登録額", "주문 등록액", "Giá trị ghi nhận đơn", "ยอดลงทะเบียนออเดอร์"],
  "reports.orderCount": ["訂單數", "Orders", "注文数", "주문 수", "Số đơn", "จำนวนออเดอร์"],
  "reports.averageOrder": ["平均客單價", "Average order value", "平均注文額", "평균 주문액", "Giá trị đơn trung bình", "ยอดเฉลี่ยต่อออเดอร์"],
  "reports.cancellationRate": ["取消率", "Cancellation rate", "キャンセル率", "취소율", "Tỷ lệ hủy", "อัตราการยกเลิก"],
  "reports.hourlySales": ["每小時訂單登記額", "Hourly order-entry amount", "時間別注文登録額", "시간별 주문 등록액", "Giá trị ghi nhận theo giờ", "ยอดลงทะเบียนรายชั่วโมง"],
  "reports.cancellationAnalysis": ["取消原因分析", "Cancellation reasons", "キャンセル理由分析", "취소 사유 분석", "Phân tích lý do hủy", "วิเคราะห์เหตุผลการยกเลิก"],
  "reports.noCancellations": ["此區間沒有取消訂單。", "There were no cancelled orders in this period.", "この期間にキャンセル注文はありません。", "이 기간에는 취소된 주문이 없습니다.", "Không có đơn bị hủy trong khoảng này.", "ไม่มีออเดอร์ที่ยกเลิกในช่วงนี้"],
  "reports.dailyTrend": ["每日訂單登記趨勢", "Daily order-entry trend", "日別注文登録推移", "일별 주문 등록 추세", "Xu hướng ghi nhận đơn hằng ngày", "แนวโน้มยอดลงทะเบียนรายวัน"],
  "reports.weeklyTrend": ["每週訂單登記趨勢", "Weekly order-entry trend", "週別注文登録推移", "주별 주문 등록 추세", "Xu hướng ghi nhận đơn hằng tuần", "แนวโน้มยอดลงทะเบียนรายสัปดาห์"],
  "reports.weekStart": ["{date} 起", "From {date}", "{date} から", "{date}부터", "Từ {date}", "ตั้งแต่ {date}"],
  "reports.noOrderData": ["此區間尚無訂單資料。", "There is no order data for this period.", "この期間の注文データはありません。", "이 기간의 주문 데이터가 없습니다.", "Không có dữ liệu đơn trong khoảng này.", "ไม่มีข้อมูลออเดอร์ในช่วงนี้"],
  "reports.payments.title": ["付款分析", "Payment analysis", "支払い分析", "결제 분석", "Phân tích thanh toán", "วิเคราะห์การชำระเงิน"],
  "reports.payments.description": ["依實際收款時間與付款方式統計；稍後結帳列在實際收款營業日，現金歸入當時開啟的班別。", "Based on actual payment time and method. Pay-later orders appear on the business day they are paid, and cash belongs to the shift open at that time.", "実際の入金時刻と支払い方法で集計します。後払いは実際の入金営業日に計上され、現金はその時点で開いているシフトに属します。", "실제 결제 시각과 방식으로 집계합니다. 후결제 주문은 실제 수납 영업일에 반영되고 현금은 당시 열린 교대에 귀속됩니다.", "Thống kê theo thời điểm và phương thức thu tiền thực tế. Đơn trả sau được ghi vào ngày kinh doanh nhận tiền, còn tiền mặt thuộc ca đang mở lúc đó.", "สรุปตามเวลารับเงินจริงและวิธีชำระ ออเดอร์ชำระภายหลังจะอยู่ในวันทำการที่รับเงินจริง และเงินสดจะอยู่ในกะที่เปิดอยู่ขณะนั้น"],
  "reports.payments.summary": ["付款摘要", "Payment summary", "支払い概要", "결제 요약", "Tóm tắt thanh toán", "สรุปการชำระเงิน"],
  "reports.payments.unpaid": ["未付款訂單", "Unpaid orders", "未払い注文", "미결제 주문", "Đơn chưa thanh toán", "ออเดอร์ค้างชำระ"],
  "reports.payments.byStall": ["各攤付款方式", "Payment methods by stall", "店舗別支払い方法", "매장별 결제 방식", "Phương thức thanh toán theo quầy", "วิธีชำระตามร้าน"],
  "reports.payments.none": ["此區間尚無已付款訂單。", "There are no paid orders in this period.", "この期間に支払い済み注文はありません。", "이 기간에 결제된 주문이 없습니다.", "Không có đơn đã thanh toán trong khoảng này.", "ไม่มีออเดอร์ที่ชำระแล้วในช่วงนี้"],
  "reports.stalls.title": ["攤位績效比較", "Stall performance comparison", "店舗実績比較", "매장 성과 비교", "So sánh hiệu suất quầy", "เปรียบเทียบผลงานร้าน"],
  "reports.stalls.description": ["比較訂單登記額、訂單、未付款與取消率；實收請至付款分析查看。", "Compare order-entry amounts, orders, unpaid counts, and cancellation rates. See Payment Analysis for receipts.", "注文登録額、注文数、未払い、キャンセル率を比較します。実収は支払い分析で確認してください。", "주문 등록액, 주문, 미결제 및 취소율을 비교합니다. 실수납은 결제 분석에서 확인하세요.", "So sánh giá trị ghi nhận đơn, số đơn, chưa thanh toán và tỷ lệ hủy. Xem tiền thực thu ở Phân tích thanh toán.", "เปรียบเทียบยอดลงทะเบียน จำนวนออเดอร์ ค้างชำระ และอัตรายกเลิก ดูยอดรับจริงในวิเคราะห์การชำระเงิน"],
  "reports.stalls.stall": ["攤位", "Stall", "店舗", "매장", "Quầy", "ร้าน"],
  "reports.stalls.completed": ["完成", "Completed", "完了", "완료", "Hoàn tất", "เสร็จสิ้น"],
  "reports.stalls.pending": ["待處理", "Pending", "処理待ち", "처리 대기", "Chờ xử lý", "รอดำเนินการ"],
  "reports.stalls.unpaid": ["未付款", "Unpaid", "未払い", "미결제", "Chưa thanh toán", "ค้างชำระ"],
  "reports.products.title": ["商品與時段分析", "Product and hourly analysis", "商品・時間帯分析", "상품 및 시간대 분석", "Phân tích sản phẩm và khung giờ", "วิเคราะห์สินค้าและช่วงเวลา"],
  "reports.products.description": ["使用訂單成立時的商品名稱與成交單價快照。", "Uses the product name and final unit-price snapshot from when each order was placed.", "注文成立時の商品名と成約単価のスナップショットを使用します。", "주문 생성 당시 상품명과 최종 단가 스냅샷을 사용합니다.", "Dùng ảnh chụp tên sản phẩm và đơn giá tại thời điểm tạo đơn.", "ใช้ข้อมูลชื่อสินค้าและราคาต่อหน่วย ณ เวลาที่สร้างออเดอร์"],
  "reports.products.organizationTop": ["全組織熱銷商品", "Top products across the organization", "組織全体の売れ筋商品", "전체 조직 인기 상품", "Sản phẩm bán chạy toàn tổ chức", "สินค้าขายดีทั้งองค์กร"],
  "reports.products.stallTop": ["各攤熱銷商品", "Top products by stall", "店舗別売れ筋商品", "매장별 인기 상품", "Sản phẩm bán chạy theo quầy", "สินค้าขายดีตามร้าน"],
  "reports.products.groups": ["商品群組銷售", "Sales by product group", "商品グループ別売上", "상품 그룹별 매출", "Doanh số theo nhóm sản phẩm", "ยอดขายตามกลุ่มสินค้า"],
  "reports.products.ungrouped": ["未分組", "Ungrouped", "グループなし", "미분류 그룹", "Chưa phân nhóm", "ไม่มีกลุ่ม"],
  "reports.products.hourly": ["每小時訂單登記額比較", "Hourly order-entry comparison", "時間別注文登録額比較", "시간별 주문 등록액 비교", "So sánh giá trị ghi nhận theo giờ", "เปรียบเทียบยอดลงทะเบียนรายชั่วโมง"],
  "reports.products.none": ["此區間尚無已完成商品銷售。", "There are no completed product sales in this period.", "この期間に完了した商品販売はありません。", "이 기간에 완료된 상품 판매가 없습니다.", "Không có sản phẩm bán hoàn tất trong khoảng này.", "ไม่มียอดขายสินค้าที่เสร็จสิ้นในช่วงนี้"],
  "reports.products.noHourly": ["此區間尚無時段資料。", "There is no hourly data for this period.", "この期間の時間帯データはありません。", "이 기간의 시간대 데이터가 없습니다.", "Không có dữ liệu theo giờ trong khoảng này.", "ไม่มีข้อมูลรายชั่วโมงในช่วงนี้"],
  "reports.orders.title": ["所有訂單查詢", "All order history", "全注文履歴", "전체 주문 내역", "Lịch sử tất cả đơn", "ประวัติออเดอร์ทั้งหมด"],
  "reports.orders.description": ["依訂單建立營業日查詢所有狀態與品項；日、週、月及自訂日期區間共用下方篩選。", "Search every status and item by order-entry business date. Use day, week, month, or a custom range below.", "注文登録営業日を基準に、全状態と品目を検索します。日・週・月・任意期間を選択できます。", "주문 등록 영업일 기준으로 모든 상태와 품목을 조회합니다. 일·주·월 또는 사용자 지정 기간을 선택하세요.", "Tra cứu mọi trạng thái và món theo ngày kinh doanh tạo đơn; chọn ngày, tuần, tháng hoặc khoảng tùy chỉnh.", "ค้นหาทุกสถานะและรายการตามวันทำการที่สร้างออเดอร์ เลือกวัน สัปดาห์ เดือน หรือช่วงเองได้"],
  "reports.orders.none": ["此區間沒有訂單。", "There are no orders in this period.", "この期間に注文はありません。", "이 기간에는 주문이 없습니다.", "Không có đơn trong khoảng này.", "ไม่มีออเดอร์ในช่วงนี้"],
  "reports.orders.limit": ["每次最多顯示 1,000 筆；需要更長區間時請分段查詢。", "Up to 1,000 orders are shown; split longer periods into smaller ranges.", "最大1,000件を表示します。長期間は分割して検索してください。", "최대 1,000건을 표시합니다. 긴 기간은 나누어 조회하세요.", "Hiển thị tối đa 1.000 đơn; hãy chia nhỏ khoảng thời gian dài.", "แสดงสูงสุด 1,000 ออเดอร์ ช่วงยาวควรแบ่งค้นหา"],
  "reports.orders.walkIn": ["現場顧客", "Walk-in customer", "店頭顧客", "현장 고객", "Khách tại quầy", "ลูกค้าหน้าร้าน"],
  "reports.orders.payment": ["付款", "Payment", "支払い", "결제", "Thanh toán", "การชำระเงิน"],
  "reports.orders.unpaid": ["未付款", "Unpaid", "未払い", "미결제", "Chưa thanh toán", "ยังไม่ชำระ"],
  "reports.orders.note": ["備註", "Note", "メモ", "메모", "Ghi chú", "หมายเหตุ"],
  "reports.orders.status.waiting": ["待確認", "Awaiting confirmation", "確認待ち", "확인 대기", "Chờ xác nhận", "รอยืนยัน"],
  "reports.orders.status.confirmed": ["已確認", "Confirmed", "確認済み", "확인됨", "Đã xác nhận", "ยืนยันแล้ว"],
  "reports.orders.status.preparing": ["製作中", "Preparing", "調理中", "준비 중", "Đang chuẩn bị", "กำลังเตรียม"],
  "reports.orders.status.packing": ["包裝中", "Packing", "包装中", "포장 중", "Đang đóng gói", "กำลังแพ็ก"],
  "reports.orders.status.ready": ["待取餐／送達", "Ready", "受取待ち", "수령 대기", "Sẵn sàng", "พร้อมรับ"],
  "reports.orders.status.completed": ["已完成", "Completed", "完了", "완료", "Hoàn tất", "เสร็จแล้ว"],
  "reports.orders.status.cancelled": ["已取消", "Cancelled", "取消済み", "취소됨", "Đã hủy", "ยกเลิกแล้ว"],
  "reports.orders.status.expired": ["已逾期", "Expired", "期限切れ", "만료됨", "Đã hết hạn", "หมดอายุ"],
  "reports.orders.fulfillment.takeout": ["外帶自取", "Pickup", "テイクアウト", "포장 수령", "Tự đến lấy", "รับเอง"],
  "reports.orders.fulfillment.dineIn": ["內用", "Dine-in", "店内", "매장 식사", "Dùng tại chỗ", "ทานที่ร้าน"],
  "reports.orders.fulfillment.delivery": ["外送", "Delivery", "配達", "배달", "Giao hàng", "จัดส่ง"],
  "reports.cash.title": ["現金交班與短溢收", "Cash shifts and variance", "現金シフトと過不足", "현금 교대 및 차이", "Ca tiền mặt và chênh lệch", "กะเงินสดและส่วนต่าง"],
  "reports.cash.description": ["檢視開班、現金收支、系統應有、實際盤點及複核狀態。", "Review opening cash, movements, expected cash, counted cash, and review status.", "開始金、現金収支、システム上の予定額、実査額、確認状況を表示します。", "시재, 현금 입출금, 시스템 예상액, 실사액 및 검토 상태를 확인합니다.", "Xem tiền đầu ca, thu chi, tiền hệ thống dự kiến, tiền kiểm đếm và trạng thái duyệt.", "ดูเงินเปิดกะ รายรับรายจ่าย เงินที่ระบบคาดไว้ เงินนับจริง และสถานะตรวจสอบ"],
  "reports.cash.summary": ["現金交班摘要", "Cash-shift summary", "現金シフト概要", "현금 교대 요약", "Tóm tắt ca tiền mặt", "สรุปกะเงินสด"],
  "reports.cash.shifts": ["班次", "Shifts", "シフト", "교대", "Ca", "กะ"],
  "reports.cash.sales": ["實收現金", "Cash received", "現金実収", "현금 실수납", "Tiền mặt thực thu", "เงินสดรับจริง"],
  "reports.cash.refunds": ["現金退款", "Cash refunds", "現金返金", "현금 환불", "Hoàn tiền mặt", "คืนเงินสด"],
  "reports.cash.expected": ["系統應有", "System expected", "システム予定額", "시스템 예상액", "Hệ thống dự kiến", "ยอดที่ระบบคาดไว้"],
  "reports.cash.variance": ["短溢收合計", "Total variance", "過不足合計", "차이 합계", "Tổng chênh lệch", "ผลต่างรวม"],
  "reports.cash.review": ["待複核", "Awaiting review", "確認待ち", "검토 대기", "Chờ duyệt", "รอตรวจสอบ"],
  "reports.cash.details": ["班次明細", "Shift details", "シフト明細", "교대 상세", "Chi tiết ca", "รายละเอียดกะ"],
  "reports.cash.opening": ["開班", "Opening", "開始金", "시재", "Đầu ca", "เงินเปิดกะ"],
  "reports.cash.inOut": ["收入／支出", "Cash in/out", "入金／出金", "입금/출금", "Thu/chi", "รับ/จ่าย"],
  "reports.cash.correction": ["更正", "Correction", "修正", "정정", "Điều chỉnh", "ปรับแก้"],
  "reports.cash.counted": ["盤點", "Counted", "実査", "실사", "Kiểm đếm", "ยอดนับจริง"],
  "reports.cash.latestReview": ["最近複核：{decision}", "Latest review: {decision}", "最新確認：{decision}", "최근 검토: {decision}", "Lần duyệt gần nhất: {decision}", "การตรวจสอบล่าสุด: {decision}"],
  "reports.cash.status.open": ["進行中", "Open", "進行中", "진행 중", "Đang mở", "กำลังดำเนินการ"],
  "reports.cash.status.closing": ["等待複核", "Awaiting review", "確認待ち", "검토 대기", "Chờ duyệt", "รอตรวจสอบ"],
  "reports.cash.status.reviewRequired": ["需要更正", "Correction required", "修正が必要", "수정 필요", "Cần điều chỉnh", "ต้องแก้ไข"],
  "reports.cash.status.closed": ["已結班", "Closed", "終了", "마감됨", "Đã đóng ca", "ปิดกะแล้ว"],
  "reports.cash.review.approved": ["核准", "Approved", "承認", "승인", "Đã duyệt", "อนุมัติแล้ว"],
  "reports.cash.review.rejected": ["退回", "Rejected", "差し戻し", "반려", "Từ chối", "ส่งกลับ"],
  "reports.cash.review.adjustmentRequired": ["要求更正", "Adjustment required", "修正要求", "수정 요청", "Yêu cầu điều chỉnh", "ต้องปรับแก้"],
  "reports.cash.none": ["所選區間尚無現金班次。", "There are no cash shifts in the selected period.", "選択期間に現金シフトはありません。", "선택 기간에 현금 교대가 없습니다.", "Không có ca tiền mặt trong khoảng đã chọn.", "ไม่มีกะเงินสดในช่วงที่เลือก"],
} as const satisfies Record<string, ReportMessageRow>;

export type ReportMessageKey = keyof typeof definitions;

const effectiveDefinitions: Record<ReportMessageKey, ReportMessageRow> = {
  ...definitions,
  ...reportDescriptionOverrides,
};

function messagesFor(locale: AppLocale): Record<ReportMessageKey, string> {
  const index = { "zh-TW": 0, en: 1, ja: 2, ko: 3, vi: 4, th: 5 }[locale];
  return Object.fromEntries(Object.entries(effectiveDefinitions).map(([key, row]) => [key, row[index]])) as Record<ReportMessageKey, string>;
}

const catalog = createMessageCatalog(messagesFor("zh-TW"), {
  en: messagesFor("en"), ja: messagesFor("ja"), ko: messagesFor("ko"), vi: messagesFor("vi"), th: messagesFor("th"),
});

export function getReportMessage(locale: AppLocale, key: ReportMessageKey, values: MessageValues = {}) {
  return catalog.get(locale, key, values);
}

export function createReportTranslator(locale: AppLocale) {
  return (key: ReportMessageKey, values: MessageValues = {}) => getReportMessage(locale, key, values);
}

export const reportMessages = catalog.messages;
