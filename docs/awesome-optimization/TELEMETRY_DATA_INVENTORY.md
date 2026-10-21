# B6a 資料清單與收集邊界

2026-10-02 實作草稿。Local focused tests 與實際流程證據分開列於 `batch-6-report.md`；資料庫、瀏覽器、Native、外部供應商與發布結果以當次收據為準，本文不代表驗收或法遵認證。

| 類別／既有責任 | 實際資料、同意與目的地 | 保留／清除 |
|---|---|---|
| Vercel Analytics / SpeedInsights | **Disabled**。既有 root component 不再 import 或 mount 兩個 SDK；即使 VERCEL=1、偏好 ON，也不啟用。已安裝 wrapper 會 append 持續 script；沒有經驗證的 withdrawal dispose，因此不聲稱 ON 收集或立即停止的供應商證據。 | 本批不送新資料；既有供應商歷史保留未核實。URL redaction 不是 consent proof。 |
| Product analytics | Server only，notification preferences / feedback durable success 後，重新查 current session + persisted analyticsConsent。未知、無 row、匿名、失效、查詢失敗均 OFF；Production 固定 Noop、無 endpoint、無網路。 | Noop 0；Test adapter 僅 trusted test composition，最多 100 events；flush/reset/withdrawal/logout 清除。每次 capture 50ms；同次兩 category 並行共用時間上界，失敗不回滾業務。 |
| First-party feedback | 使用者主動輸入 ISSUE/SUGGESTION、最多 trimmed 2000 字。保護資料表儲存 profile FK、選填 current organization FK、server surface、文字、status/version/timestamps；不是 analytics。UI 提醒勿放秘密／顧客個資；仍按可能含個資管理。 | 作業預設 90 天（待擁有人正式政策確認）；reads 立即排除已到期。既有 outbox cron 完成 delivery 後，獨立 transaction 最多刪 500 筆 expired feedback；不另排程，cleanup failure 不改 delivery 結果。備份依既有政策，未聲稱即時備份抹除。 |
| Error feedback correlation | 選填原錯誤 UUID，僅同 actor + same organization/null + FAILURE + 24h 內既有 audit 可連結。當前 Inbox 503 writes minimal failure audit；UI 手動回報連結。提交新 requestId 僅 HTTP correlation，不冒充原錯誤。unknown/foreign 相同拒絕、不返回 audit。 | 同 feedback expiry；audit 本身沿原政策，本批未認定其期限。UUID 是追蹤碼，不能授權看 log；永不送 analytics。 |
| Operational trace / audit / client exception | 原 logging/auth audit/client exception 既有責任；錯誤 message、SQL、headers/body、order/customer/recipient/QR/token 不加入 product events。匿名 client-errors 未改。B6b report trace 尚未實作。 | 各原政策未核實值不杜撰；本批不新建 collector。 |

唯一事件欄位白名單（所有 object strict，包括 Noop）：

- `notification_preference_changed`: `surface` 1 Web / 2 Native；`category` 1 billing / 2 application；`enabled` 0/1。僅實際改變的類別；staff visibility 沒有指定 enum，故不編造第三類。
- `feedback_submitted`: `surface` 1 Web / 2 Native；`kind` 1 ISSUE / 2 SUGGESTION；`outcome` 固定 1 durable success。当前 feedback 只有 Web route，Native feedback 未接入。

事件不允許任意字串／nested map／NaN／Infinity／name/email/phone/address/URL/token/LINE ID/文字/tenant/profile/order/request IDs。不是匿名性保證；分類為最小化產品遙測。無 replay/autocapture、外部 feature flag、session recording、問卷 SDK 或任何 provider selector。偏好不是 entitlement、管理員資格或組織權限。

Web 與原 Native logout 在既有撤銷後清除 optional analytics pending/Test buffers；Native token/device/NATIVE actor 解析沿既有 helper，無新 auth。Native runtime、physical device 與 SDK withdrawal/provider 驗證保持 NOT_RUN。
