# 顧客訂單修改與取餐時間回覆修復

狀態：本機修正與主要驗證完成；正式環境尚未部署。

## 已確認原因

1. 正式發佈腳本把 Supabase Management API 的 secret-list `value` 當成密鑰原文。該欄位實際是 SHA-256 摘要，導致應用程式與 Edge 的裝置雜湊及 Turnstile 設定不一致。每次沿用此流程發佈，可能重新帶入錯誤設定。
2. 取餐時間回覆直接用應用程式的裝置雜湊呼叫 RPC，缺少其他訂單修改路徑已有的 canonical 驗證復原；摘要錯置時，接受與拒絕都可能得到 `ORDER_NOT_FOUND`。
3. 前端未區分找不到訂單、提議已更新／已回覆／逾時、系統異常與商家關閉，形成不準確的通用錯誤。
4. 商家確認後的舊規則曾允許顧客修改；依本次最新指示，現在確認即鎖定，送出前及交易鎖內都檢查。顧客售完商品不得借用店員可售完照點的權限。

Supabase 官方證據：[Studio 顯示 secret 的 SHA256 摘要](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Functions/EdgeFunctionSecrets/EdgeFunctionSecrets.tsx)、[儲存後不能重新取得原值](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/Functions/EdgeFunctionSecrets/EditSecretSheet.tsx)。

## 修正範圍

- 發佈及 DR 複製採用受保護的原始值，先比對摘要；缺值或不一致即停止，不匯出部分環境。
- 取餐時間回覆在本機雜湊查無資料時，必須先由 canonical Edge 驗證同一 tracking token 與 device，才能使用該筆訂單的正確裝置雜湊呼叫原本會鎖定資料的 RPC。版本、狀態與逾時規則保持有效。
- 已確認訂單顯示「商家已確認訂單，無法修改訂單」；原表單若仍開著，後端同樣拒絕。取消／完成／逾時訂單不再提供時間回覆按鈕。
- 提議衝突會更新畫面並顯示明確訊息。回覆的前端等待預算涵蓋既有的 4 秒 canonical 驗證及資料庫操作；並非更改資料庫鎖定或無限重試。
- 伺服器紀錄僅留下 request ID 與允許的錯誤代碼，不記錄原始資料庫錯誤訊息。

## 實際驗證

- 獨立 worktree：`Stallorder-Platform-hotfix-customer-edit-20260906`；基準 `1ac06da8c8d6bd061ddcfe2dec63409dc9a22936`。
- 獨立本機 Supabase：API 55621、DB 55622；本機 UI 3016。正式與原本本機資料庫未套用測試資料。
- `e2e/qr-edit-local-flow.spec.ts`：QR／外帶修改原單、聯絡資料保留及取消通過。
- `e2e/preorder-shared-link-cross-role.spec.ts`：預約選時、失效商品移除及 Staff／KDS／Tracker 同單流程通過。
- `e2e/customer-order-lifecycle.spec.ts`：連續三次修改、接受／拒絕、重複及舊版本回覆、錯誤裝置、已確認鎖定、320/390/768/1440 寬度。啟用 `LOCAL_CANONICAL_DRIFT_TEST=true` 會把本機應用端密鑰故意換成摘要，以真實本機 Edge 與資料庫驗證復原。
- 以上新增 lifecycle 在 development 44.0 秒與 production build 12.7 秒均為 2/2 通過，兩者均啟用真實 canonical drift 測試。Production build 的隔離 HTTP 測試自行轉送登入取得的 Secure cookie，沒有修改產品的 cookie 安全規則。測試依原本功能旗標機制開啟 Circuit B，結束後刪除自己建立的 override。
- 67 組 pgTAP、1,543 項通過。Windows Supabase CLI 的資料庫連線介面失敗，因此使用同一隔離容器內的 psql 執行原始 SQL，驗證 TAP 計畫數、結果數與每項結果，未跳過失敗項目。
- 整體單元測試 3,011 項通過、9 項既有條件式跳過；追加的復原協調測試 5 項通過。型別、Lint、UI audit、production guardrails、production build 通過；依賴 audit 為 0 弱點。
- DB lint 使用 Supabase 官方 `plpgsql_check_function(..., format:='json')` 查詢檢查 public/app_private，包含 warning，結果無問題。原始參考：https://github.com/supabase/cli/blob/v2.75.0/internal/db/lint/templates/check.sql 。整個檢查以 transaction rollback 結束。
- Gitleaks 掃描本次 staged diff（約 86.95 KB），0 洩漏。安全性控制已驗證 origin、錯誤裝置、canonical 無法使用、訂單版本／状态、confirmed race、原值摘要不一致停止輸出，以及復原端點的權限／期限／加密／清理；未執行整個專案的 Deep Security Scan。

## 正式密鑰來源

API 授權讀取成功。已透過 Cloudflare 官方管理 API 取回 Turnstile 原值，且在本機確認 SHA-256 與正式 Supabase 相符；存放在 git 忽略的本機秘密檔，本文不含數值。

`ABUSE_HASH_SECRET` 與 `TOKEN_DERIVATION_SECRET` 尚未找到原始備份。已檢查本機專案設定、使用者／系統／程序的 PowerShell Environment 設定及 PSReadLine 歷史；不能從單向摘要還原。正式恢復須保留舊訂單的裝置驗證相容性，不能直接以新值取代。沒有密鑰來源與正式驗證收據前，不得標為已上線。

## 受保護的原值復原程序

新增 `Production Public Order Secret Recovery` Plan/Apply，固定取回上述兩個名稱。Plan 綁定 main/staging 相同內容樹、當前 Supabase 專案、兩個正式摘要及本機 RSA 4096 公鑰指紋。Apply 須以目前 Plan run ID 與 `RECOVER_PUBLIC_ORDER_ORIGINAL_SECRETS` 確認，沿用既有 owner、期限及 commit/tree 驗證。

Apply 部署一個隨機命名、最多有效五分鐘的暫存 Edge Function。Supabase JWT 檢查保持開啟，函式另驗證 service-role、256-bit 隨機 nonce、期限與專案。只在原值摘要吻合時，以 AES-256-GCM 加密並用本機 RSA 公鑰封裝金鑰；私鑰不上傳。無 CORS、無任意 secret 名稱查詢、無明文回應或明文 artifact。

成功及失敗均刪除本次產生的確切函式，管理 API 回讀確認不存在後，才上傳加密封套。若工作流程被中斷而來不及刪除，函式到期即拒絕；須完成刪除確認才能繼續正式發佈。由本機私鑰解密後，再讀正式摘要逐一核對，才保存到 git 忽略檔。此程序不輪替密鑰、不修改訂單資料、不部署其他功能。

首次核准 Plan `34083711597`，Apply `34084006656` 在 2026-09-07 12:41（台灣時間）啟動暫存函式後得到 HTTP 404，未交付密鑰。清理流程完成，管理 API 再次確認沒有殘留 recovery 函式。唯讀比對證實：內建 `SUPABASE_URL` 的摘要符合專案，但內建 `SUPABASE_SERVICE_ROLE_KEY` 的摘要與管理 API 當前回傳的 service-role JWT 不同，因此舊版 runtime key 比對會拒絕呼叫；管理 API 及 JWT gateway 授權並未過期。

修正將函式授權綁定到本次受信任管理 API 取得的精確 service-role JWT 指紋，不再依賴與該 JWT 不同的內建環境值。JWT gateway、nonce、專案、五分鐘期限、兩個原始密鑰摘要及加密／清理要求保持有效。程式只記錄 HTTP 狀態與確切暫存函式刪除完成事件，不印出 provider response、JWT 或原始密鑰。

測試先重現內建 runtime key 漂移導致拒絕，再驗證當前 service-role JWT 成功、舊 runtime JWT 拒絕、缺少 JWT 指紋拒絕。既有加解密、匿名／一般 JWT／錯 nonce／過期／錯專案／摘要漂移拒絕，以及 Plan 失敗不部署、呼叫失敗與部署結果不明時清理持續涵蓋。修正版必須重新取得相符 commit/tree 的 Plan/Apply；舊 Plan 不適用新版本。

修正版驗證：相關 32 項、完整 Vitest 3,019 項通過（9 項既有條件式跳過），lint、production guardrails、依賴 audit 通過。以同一 handler 原始碼在隔離的本機 Supabase Edge 實際執行，使用測試用密鑰重現 runtime key 漂移，當前 JWT 加密交付及本機解密通過，舊 JWT／錯 nonce／GET 全數拒絕；暫存本機 fixture 已刪除。此本機 Edge 證據涵蓋函式內驗證和 Web Crypto，正式 gateway JWT 驗證仍須由新的受保護 Apply 驗證。應用程式、資料庫及一般 Edge 功能檔案與已驗證的 `02ac137` 完全相同。

## 其餘需求

只有新單音效、餐具選擇、三區滿版平板看板、特殊休假通知與系統更新遮罩，均依使用者指示限定本機測試。iPad 關屏通知建議另附本機功能文件；沒有實體 iPad 的關屏測試不得聲稱已驗證。
