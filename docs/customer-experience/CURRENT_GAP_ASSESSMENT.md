# 顧客點餐與會員體驗現況差距

更新日期：2026-08-26

本文件以目前程式碼與本機資料庫為依據。`組織成員`、`攤位成員`與商家登入皆屬工作人員身分，不視為顧客會員。既有 CRM／點數資料層仍受 `CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED` 預設關閉閘門保護；在顧客身分驗證、同意文案與外部供應商完成前，不應開啟正式顧客會員功能。

| Capability | Existing production path | Foundation only | Missing | Evidence | Action |
|---|---:|---:|---:|---|---|
| QR session context | ✓ |  |  | `src/app/q/[qrToken]/page.tsx`、`src/components/qr-order-session-controller.ts` | 保留既有安全工作階段與逾時復原。 |
| Mobile menu | ✓ |  |  | `src/components/qr-order-flow-presentation.tsx`、`src/components/qr-order-menu.tsx` | 延伸既有 `/q/[qrToken]`，不另建脫節店面。 |
| Sticky cart | ✓ |  |  | `src/components/qr-order-flow-presentation.tsx` 的 `qr-mobile-cart-summary` | 維持安全區、44px 觸控與 360px 無橫向溢位。 |
| Cart bottom sheet | ✓ |  |  | `src/components/qr-order-cart-panel.tsx` | 保留獨立客製品項、修改完成與焦點生命週期。 |
| Checkout sections |  | ✓ |  | `src/components/qr-order-cart-panel.tsx` | 目前已有姓名、電話、地址、備註與送單；付款、發票、優惠仍須分階段補齊。 |
| Guest ordering | ✓ |  |  | `src/components/qr-order-flow-controller.ts`、`src/lib/public-order-client.ts` | 會員功能不得阻擋訪客點餐。 |
| Customer sign-in |  |  | ✓ | 無獨立顧客登入路由或顧客 session | 先建立專用顧客身分／session；不可重用商家 session。 |
| Phone OTP |  |  | ✓ | 無 `CustomerOtpProvider` 或顧客 OTP API | 建立 provider-neutral adapter 與本機 mock；正式 SMS 憑證完成前維持關閉。 |
| LINE customer identity |  | ✓ |  | `src/server/notifications/line-oauth.ts` 僅提供既有 LINE 原語；`CustomerContactLink` 用於通知連結 | 分離商家 LINE 登入、官方帳號通知與顧客 LINE Login／LIFF。 |
| Customer profile |  | ✓ |  | `supabase/migrations/20260821012145_crm_loyalty_consent_foundation.sql` 的 `crm_profiles` | 以加法 migration 建立已驗證顧客身分對應，不自動匯入訂單電話。 |
| Consent UI |  | ✓ |  | `crm_consent_records` 已有不可變同意紀錄，尚無顧客 UI | 會員、忠誠、通知與行銷同意須拆開，文案核准前維持關閉。 |
| Order history |  |  | ✓ | 目前只有單筆公開追蹤與再點一次 | 顧客身分完成後，以組織範圍且 tenant-safe 的關聯提供歷史訂單。 |
| Points balance |  | ✓ |  | `loyalty_accounts`、`loyalty_points_ledger` | 維持不可變 ledger；發放、抵用與退款規則核准後才啟用。 |
| Coupon wallet |  |  | ✓ | 目前活動設定不等於顧客錢包 | 增加顧客持有、狀態、有效期及併用規則。 |
| Payment selection |  | ✓ |  | 公開點餐目前以店內付款狀態為主；既有商家付款模組不可直接當顧客 hosted checkout | 先定義 server-authoritative payment state machine，再接正式供應商。 |
| Invoice selection |  |  | ✓ | 公開結帳未提供發票選擇 | 待發票政策與供應商核准後新增，不能阻斷不需發票的點餐。 |
| Order tracker | ✓ |  |  | `src/components/public-order-tracker.tsx`、`src/app/order/[trackingToken]/page.tsx` | 保留不透明 tracking token、輪詢／即時降級與取餐提示。 |
| Pickup barcode |  | ✓ |  | 已有每日三碼取餐驗證與公開追蹤顯示，尚無條碼 | 短期使用不重複三碼；條碼另以功能旗標及簽章內容導入。 |
| Merchant CRM UI |  | ✓ |  | `src/server/growth/growth-service.ts`、`src/components/growth-center.tsx` | 先呈現唯讀準備度；顧客同意與 provider 就緒前禁止觸達。 |
| Sandbox/Production readiness |  | ✓ |  | `docs/CRM_LOYALTY_CONSENT_FOUNDATION_ADR.md`、預設關閉旗標 | 依 Local Mock → CI → Preview → Staging → Pilot 漸進開啟，正式環境需產品、法務／隱私與資安核准。 |

## 本機這一輪的安全邊界

- 維持訪客可以瀏覽、加入購物車、結帳與追蹤訂單。
- 先完成響應式顧客入口與可恢復狀態的架構切片；未設定的會員 provider 必須明確顯示尚未開放且 fail closed。
- 不建立顧客密碼、不把工作人員帳號當顧客帳號、不由訂單聯絡資料推斷會員。
- 本機驗證完成前不推送，不同步 DR 或 Production。
