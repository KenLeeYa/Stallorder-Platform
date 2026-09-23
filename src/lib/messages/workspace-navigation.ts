import type { AppLocale } from "@/lib/app-locale";

const row = (zh: string, en: string, ja: string, ko: string, vi: string, th: string): Record<AppLocale, string> => ({ "zh-TW": zh, en, ja, ko, vi, th });
const messages = {
  otherSource: row("其他來源", "Other source", "その他の注文元", "기타 경로", "Nguồn khác", "แหล่งอื่น"),
  all: row("所有功能", "All functions", "すべての機能", "모든 기능", "Tất cả chức năng", "ฟังก์ชันทั้งหมด"),
  search: row("搜尋功能", "Find a function", "機能を検索", "기능 검색", "Tìm chức năng", "ค้นหาฟังก์ชัน"),
  empty: row("找不到符合的功能，請換個關鍵字。", "No matching functions. Try another keyword.", "該当する機能がありません。別の語句をお試しください。", "일치하는 기능이 없습니다. 다른 검색어를 입력하세요.", "Không tìm thấy chức năng. Thử từ khóa khác.", "ไม่พบฟังก์ชัน ลองคำค้นอื่น"),
  close: row("關閉", "Close", "閉じる", "닫기", "Đóng", "ปิด"),
  location: row("目前位置", "Current location", "現在の位置", "현재 위치", "Vị trí hiện tại", "ตำแหน่งปัจจุบัน"),
  operations: row("營運", "Operations", "運営", "운영", "Vận hành", "การดำเนินงาน"),
  merchants: row("商家與商品", "Merchants & catalog", "店舗・商品", "매장 및 상품", "Cửa hàng & sản phẩm", "ร้านค้าและสินค้า"),
  finance: row("財務與對帳", "Finance & reconciliation", "会計・照合", "재무 및 정산", "Tài chính & đối soát", "การเงินและกระทบยอด"),
  audit: row("稽核與安全", "Audit & security", "監査・セキュリティ", "감사 및 보안", "Kiểm tra & bảo mật", "ตรวจสอบและความปลอดภัย"),
  settings: row("系統與整合", "System & integrations", "システム・連携", "시스템 및 연동", "Hệ thống & tích hợp", "ระบบและการเชื่อมต่อ"),
  tasks: row("待處理工作", "Work to review", "対応待ち", "처리할 작업", "Việc cần xử lý", "งานที่ต้องดำเนินการ"),
  scope: row("僅顯示目前帳號與商家的可用功能。", "Functions available to this account and workspace.", "このアカウントと店舗で利用できる機能です。", "현재 계정과 매장에서 사용할 수 있는 기능입니다.", "Các chức năng khả dụng cho tài khoản và cửa hàng này.", "ฟังก์ชันที่บัญชีและร้านค้านี้ใช้งานได้"),
} as const;
export type WorkspaceNavigationGroup = "operations" | "merchants" | "finance" | "audit" | "settings";
export const workspaceNavigationMessage = (locale: AppLocale, key: keyof typeof messages) => messages[key][locale];
