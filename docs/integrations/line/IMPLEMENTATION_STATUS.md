# 攤點通 LINE 整合 v2 實作狀態

更新：2026-09-28，Asia/Taipei。需求為 Downloads/prompt.md 全文 1,069 行，SHA-256 `13C37906B6BFDD829E7D53DF237603357A3EE158B30D6D725DF64B37519EB93E`。此頁取代 v1 進度；舊商家 OA 指南不能用作 v2 sender 設定。

候選：`codex/line-platform-oa-v2-20260927`，v1 checkpoint `5dcbca4309dd6aa5095c0b6418856991f2cbd480`。獨立工作樹及 clone。本次沒有部署、正式資料寫入、真實 LINE Push、Pay 收退款或選單發布。**本機候選不等於外部或正式驗收完成。**

## Phase 0：真實架構與差距

| 責任 | 原程式／資料 | v2 實際变更 |
|---|---|---|
| 應用 | Next 16.3.4、Node 24、Prisma 6.19.3、PostgreSQL/Supabase | 沿用原應用、Session、SQL migration |
| 身分 | src/server/line-miniapp、oauth_transactions、auth_identities、auth_sessions | 官方 Token verify + 精確 audience；env/Provider/sub 唯一平台顧客 |
| 會員 | 原 Profile；CustomerContactLink 實際屬單筆 order | 新會員條款／同意、不可變 order owner；不建員工 membership |
| 下單 | public-order/trusted-rpc-repository、circuit-b-service、原 session/device/價格/庫存 RPC | /api/mini/orders 沿原接單交易；原訪客歸戶需 consumed session、裝置及高熵 proof |
| 通知 | notification_integrations/jobs、Vault、原 worker | PLATFORM_OA 唯一 registry、快照/retry/lease、好友 webhook；排除舊渠道 |
| 履約 | orders/items、原 KDS／非 KDS command、order_events | READY 同交易 outbox；只有明確交付事件產生 PICKED_UP |
| 核銷 | 原 Staff、checkout 權限、完成單 Billing | 自有 PNG QR、media/取餐票據分離、preview、原子 redeem、人工核對 |
| 付款 | payment_provider_*、payments、reconciliation | 原台帳延伸、各店商家快照、UNKNOWN/退款/查核；不挪 SaaS PaymentAttempt |
| 介面 | 原 PublicStorefront/QrOrderFlow、merchant/admin | MINI 會員/本人跨店訂單、通知看板、商家查核退款 |
| Production | stallorder-platform，prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP | 基線 dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ；未寫 Primary/DR |

公開 login、staff/login、store/viet-food-yc 入口基線可訪問；匿名 health 401 不能算已登入 health 或完整訂單測試。

## 各階段

| Phase | 程式／文件 | 驗收邊界 |
|---|---|---|
| 0 | 真實 repo 盤點、官方 Pay v4/Messaging/MINI 查核 | 平台 OA、Provider及Pay Sandbox已live讀回；MINI建立草稿待條款同意 |
| 1 | ADR、七份相容 migration、FORCE RLS | 僅本機 clone，未套 Staging/Production |
| 2 | 登入交換、會員條款/選填同意、好友事件、本人跨店訂單、歸戶 | 合成登入及測試證據見 TEST_REPORT；真人登入/返回待驗 |
| 3 | 原事件→outbox→固定平台 OA adapter、舊渠道隔離 | 真 DB + provider fixture；未真實 Push/遠端 cron |
| 4 | 真 PNG、preview、明確交付、唯一事件/Billing | 本機 SQL/API/瀏覽器；相機/LINE 快取待實機 |
| 5 | Sandbox-only v4、durable operation、UNKNOWN、退款/查核 | 未執行真 Sandbox API；LIVE endpoint 不可用 |
| 6 | 平台/門市看板、用量/補發、金流操作、Rich Menu 工具 | 只有 dry-run，無 provider apply |
| 7 | 94 項矩陣及 G 組逐項記錄 | BLOCKED/NOT_RUN 不算 PASS |
| 8 | 營運/安全/回復/外部設定與整合審查 | 尚未達正式啟用關卡 |

- DB 僅 `127.0.0.1:55722/stallorder_line_miniapp_20260926`；與 3023 共用容器但不是同一 DB。保留合成 fixtures，不複製至正式。
- 3024 為臨時 HTTPS 合成 QA，假 Channel、自簽憑證，不能驗真 LINE；3023 人工環境保留。最終程序狀態見 TEST_REPORT。
- 2026-09-28 已依授權建立平台 OA「攤點通」`@028sijlm`，Messaging Channel `2011762548`／Provider `2005461563`。bot/info與訊息格式驗證通過；尚未真實Push、設定Webhook或匯入Vault。OA尚未認證。
- 既有 LINE Pay Sandbox完成OTP，Channel `2011753464` 的簽章唯讀查詢回覆HTTP 200／1150（探測訂單不存在）；尚未Request／Confirm／退款。憑證已依授權限制存於repo外私密目錄，不能把此結果當付款成功。
- MINI建立草稿仍待MINI條款與代表權聲明同意，沒有Channel／LIFF ID；公開HTTPS、法定條款、雙店帳號及裝置缺項集中在 [外部清單](EXTERNAL_SETUP_CHECKLIST.md)。完整當日證據見 [帳號設定驗證](PROVIDER_SETUP_RECEIPT_20260928.md)。
