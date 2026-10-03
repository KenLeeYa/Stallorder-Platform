import type { AppLocale } from "@/lib/app-locale";
const row = (zh: string, en: string, ja: string, ko: string, vi: string, th: string): Record<AppLocale, string> => ({ "zh-TW": zh, en, ja, ko, vi, th });
const messages = {
  search: row("搜尋餐點或分類", "Search food or category", "商品・カテゴリを検索", "메뉴 또는 분류 검색", "Tìm món hoặc danh mục", "ค้นหาอาหารหรือหมวดหมู่"),
  empty: row("找不到餐點，請換個關鍵字或清除搜尋。", "No food matches. Try another keyword or clear the search.", "商品が見つかりません。検索語を変更または解除してください。", "메뉴를 찾을 수 없습니다. 검색어를 바꾸거나 지우세요.", "Không tìm thấy món. Đổi từ khóa hoặc xóa tìm kiếm.", "ไม่พบอาหาร ลองคำค้นอื่นหรือล้างการค้นหา"),
  required: row("前往未完成的選項", "Go to missing choices", "未選択の項目へ", "미선택 항목으로 이동", "Đến lựa chọn còn thiếu", "ไปยังตัวเลือกที่ยังไม่ครบ"),
  preview: row("將影響下列商品", "Products affected", "変更する商品", "영향을 받는 상품", "Sản phẩm bị ảnh hưởng", "สินค้าที่ได้รับผลกระทบ"),
  recovery: row("儲存後可再次開啟此視窗，選「供應中」恢復。庫存不會自動增加。", "Reopen this panel and choose Available to resume. Stock is not replenished.", "この画面で「提供中」を選ぶと再開します。在庫は補充されません。", "이 화면에서 판매 중을 선택하면 재개됩니다. 재고는 보충되지 않습니다.", "Mở lại bảng này và chọn Đang bán để bán lại. Tồn kho không được bổ sung.", "เปิดหน้านี้อีกครั้งแล้วเลือกพร้อมขายเพื่อขายต่อ สต็อกจะไม่เพิ่ม"),
  scope: row("僅影響目前攤位；共用商品的其他攤位維持原設定。", "Only this stall is affected. Other stalls keep their settings.", "この店舗のみ変更します。他店舗の設定は変わりません。", "현재 매장에만 적용됩니다. 다른 매장 설정은 유지됩니다.", "Chỉ ảnh hưởng cửa hàng này. Cửa hàng khác giữ nguyên cài đặt.", "มีผลเฉพาะร้านนี้ ร้านอื่นคงการตั้งค่าเดิม"),
} as const;
export const orderingExperienceMessage = (locale: AppLocale, key: keyof typeof messages) => messages[key][locale];
