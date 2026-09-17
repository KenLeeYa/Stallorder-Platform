# 管理者健康看板與路徑權限

## 需求與範圍

2026-09-16 使用者指定：正式站 health 僅平台管理者可讀；DR 使用指定 Cloudflare 維運管理者，主系統故障時仍能查看。兩邊提供繁體中文、唯讀的 Dashboard，並盤點相關路徑權限。沒有資料庫、Edge Function、訂單流程或 DNS 異動。

| 入口 | 權限與行為 |
| --- | --- |
| `/api/health`、`/api/health/primary`、`/api/health/dr`、`/api/health/dependencies` | 伺服器驗證有效登入與 `PLATFORM_ADMIN`；匿名 401，非平台管理者 404；失敗與成功都禁止快取 |
| `/api/health/` | 308 正規化後沿用上述權限 |
| `/admin/health` | 平台管理者頁面；瀏覽器開 `/api/health` 導向此頁，未登入者走既有登入流程 |
| `/api/health/dr/operator` | DR flag、Cloudflare Access JWT 的簽章、issuer、audience、RS256、exp、iat 及 human/service 身分均須符合；瀏覽器導向 `/operator/health` |
| `/operator/health` | 僅 Cloudflare 指定人員的有效 JWT；不依賴 Primary 登入 session，不能用機器探測密鑰開啟人員頁面 |
| DR 產生的 Vercel 網域 | Vercel Standard 保護；機器探測另需精確 deployment hostname 與既有 DR 專案探測密鑰；不能僅靠偽造 email/header 放行 |
| `/api/connectivity` | 公開 GET/HEAD 僅回空本文、200/503 與最小整體狀態標記，供網路狀態燈、監控及啟動檢查；沒有各項依賴診斷、後端識別碼或版本資訊。緩慢時狀態頁仍顯示降級，不能把錯誤頁的 HTTP 200 當正常 |

Cloudflare 原有「目前帳戶成員」Allow policy 會再加上指定 email 的 Require 條件，兩者都必須符合。首次更新僅在帳戶存在唯一 accepted Super Administrator 時鎖定該人；多位候選者或非預期既有 policy 會停止，不能自行擴權。後續新增帳戶成員不會自動成為 DR 維運人員。

## 畫面與狀態

- 正式站 13 項依賴檢查、DR 5 項待命條件與所有環境欄位均有中文標籤。
- 顯示台北時間、回應延遲與重新檢查入口；手機單欄、平板／電腦雙欄，保留既有深色模式。
- 「待驗證」與「停用／維護」不列為已通過；未知檢查不能使備援就緒。不顯示密鑰或顧客資料。
- 此頁不執行故障切換、發布、資料同步或開啟備援寫入。

## 其他路徑盤點

本次來源盤點涵蓋 182 個 API route 檔案，分成：平台管理 19、商家 61、攤位／店員／廚房 35、公開顧客 18、登入 13、排程 9、health 5，以及其他整合／資源等 22。檔案掃描是盤點索引，不能當成全部路徑實際安全測試。

| 路徑類型 | 現有邊界與本次確認 |
| --- | --- |
| `/api/admin/*`、`/admin/*` | 平台管理者角色；本次 API 與頁面以四個角色實測 |
| `/api/merchant/*`、`/api/stalls/*`、店員／廚房 | 組織、攤位 membership 與功能權限；寫入另驗證 CSRF；本次匿名、非成員組織與代表性 API 實測 |
| `/api/offline/*` | 攤位權限、CSRF、裝置憑證；匿名 bootstrap 實測阻擋 |
| `/api/cron/*` | 排程秘密值驗證；沒有憑證的 staff-push 實測 401，不觸發工作 |
| LINE／外送／Apple webhook | 對應 provider adapter 驗章、事件去重；來源與現有單元回歸確認，未向實際供應商送事件 |
| CloudPRNT | 印表機裝置憑證及 job/printer 綁定；來源與既有回歸確認，未操作正式印表機 |
| 公開 Menu、圖片、取餐顯示 | 產品設計上的公開入口；顯示設定、token 與回傳資料範圍由各服務限制，不改成管理者登入 |
| 顧客訂單追蹤與修改 | 追蹤 token／device、Circuit B 或 Edge 授權與狀態規則；保持既有邊界 |
| `/api/auth/*` | 登入入口本身公開；callback/state/PKCE、session 撤銷另驗證；正式 mock provider 固定 404 |
| `/api/version`、`/api/availability/config` | PWA 更新與顧客接單提示必要的公開契約；保留最小資訊，不回傳健康診斷 |

這不是全站滲透測試結論；未宣稱每一個按鈕、實際 provider、正式帳戶與所有租戶組合都已驗證。

## 驗收與發布順序

1. `src/app/api/health/access-boundary.test.ts`：先重現未授權探測，再確認授權檢查先於資料探測。
2. `node scripts/qa-health-access.mjs`：僅 loopback fixture，51 項實際 HTTP 流程，含平台管理／商家／店員／廚房、偽造標頭、非成員組織、登出撤銷、中文看板。
3. CUA 實際平台管理者登入、重新檢查；320/390/768/1440 寬度、手機深／淺色、無整頁水平溢出，console 無錯誤。
4. `cloudflare-access.test.ts` 驗證真實簽章、到期、缺 exp、錯 issuer/audience/key；`dr-operator-authorization.test.ts` 驗證 origin、人員與機器權限隔離。
5. 完整 lint、typecheck、unit、guardrails、build、Status Worker bundle，再經 Staging CI／Ephemeral Preview；沒有 schema 變更。
6. 先發布 Status Worker：改用 connectivity；新路徑尚未發布而回 404 時，才暫時讀舊 health 格式。401/403/503 不 fallback，不能把存取失敗當正常。
7. 發布 Primary 應用程式，確認登入、網路狀態與有效測試 QR 未回歸。
8. 針對既有 DR 執行新 `plan-update`／`update`；由精確 Plan 記錄現有專案、deployment、DNS、Access policy、指定人員、唯讀 role 與 epoch。先驗證未綁網域的候選，再收窄權限並 promote。
9. DR 失敗僅回復本次可歸因的 deployment 與 policy；不刪專案、Access app 或 DNS，不覆蓋其他發布。獨立讀回 Primary 仍未變。
10. 最後從正式網址實際驗證平台管理者、Cloudflare 登入後中文看板與匿名拒絕。workflow 的 `humanDashboardVerification=PENDING_BROWSER_CHECK` 不能當人員登入完成。

本機測試使用 3026 與原已運作的 55722 資料庫；3026 測完停止，既有資料庫及其他工作區服務保留。本機 fixture 登入不會上正式環境。

2026-09-17 本機驗收：開發模式的 51 項 HTTP 角色案例與上述瀏覽器操作通過；正式建置、typecheck、UI audit、production guardrails 通過。完整單元測試以 2 workers 通過 3,303 項，9 項原有略過；未調整任何 timeout 或斷言。先前不限 workers 的一輪有兩個既有測試發生 5 秒載入逾時，相同檔案獨立重跑與完整限 worker 重跑均通過。最後另補公開狀態標記及假 HTTP 200 頁面的聚焦回歸。

本機正式建置的啟動命令遭自動核准審查以「blocked by policy」拒絕，未繞過或重試等效啟動；正式模式完整端到端驗證須由既有隔離 CI 執行。這項缺口在 CI 實際通過前不能標為已驗證。

第一輪隔離 CI `35121018753` 的帳務 E2E 在已登入平台管理者後，以 `page.request` 讀取 health 失敗。正式模式 Cookie 具有 Secure 屬性；已安裝 Playwright 的 Cookie.matches 對 HTTP 僅特許 localhost，而 CI origin 為 127.0.0.1，所以 APIRequestContext 會省略 Cookie。驗證改成由真正已登入的瀏覽器 fetch，保留 HTTP 200 與健康狀態斷言；沒有修改登入安全設定、放寬權限或跳過測試。新的健康看板 E2E 同步採此方式。該輪只有第一 shard 執行，不能視為完整通過；同輪 Ephemeral Preview `35121018665` 已通過。

本次證據存於任務 artifact `health-admin-dashboard-20260916`。尚未取得部署 receipt 與正式網址實測前，狀態僅為本機實作，不標示已上線。

## 2026-09-17 Hosted 入口回歸

使用者完成 Vercel 登入後，實際開啟 Staging `/admin/health` 被導向 `/login?next=%2Fadmin%2Fbilling`。原因是父層 AdminLayout 先執行預設帳務返回路徑的管理者檢查；子頁正確的 health 返回路徑尚未生效就被重新導向。原 E2E 直接從指定 next 的登入頁起跑，未涵蓋父層入口。

修正讓 proxy 依真正請求路徑覆寫內部 admin 返回標頭，layout 僅接受 `/admin/health` 或原 `/admin/billing`，不接受外部 URL。原管理者檢查、DR 檢查及商家範圍標頭維持。新增 proxy/layout 回歸先取得失敗，再驗證通過；health E2E 改從使用者提供的 `/api/health/` 起跑，必須經登入回到健康看板。

自動 Git Staging Preview 雖然 READY，但實際登入頁沒有可用登入方式，不能算功能驗收通過。Hosted 驗收使用既有 Ephemeral Preview 的隔離測試資料與帳號，不改共用 Preview/Production 環境變數，也不把測試資料放入正式資料庫。正式發布前仍須取得本次修正版 CI、Preview 與瀏覽器證據。
