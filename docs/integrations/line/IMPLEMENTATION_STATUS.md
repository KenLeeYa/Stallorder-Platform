# 攤點通 LINE 整合 v2 實作狀態

更新：2026-09-28，Asia/Taipei。需求為 Downloads/prompt.md 全文 1,069 行，SHA-256 `13C37906B6BFDD829E7D53DF237603357A3EE158B30D6D725DF64B37519EB93E`。此頁取代 v1 進度；舊商家 OA 指南不能用作 v2 sender 設定。

候選：`codex/line-platform-oa-v2-20260927`，v1 checkpoint `5dcbca4309dd6aa5095c0b6418856991f2cbd480`。15:26 台北：公開隔離站已執行 `a1b5f12`／`dpl_FcDxJVsKt9DJPknM3YFNvxB5Jx3w`，完整 CI／CodeQL 通過。真 LINE 登入、會員／通知同意、官方好友查核、同一會員 A/B 列表、原點餐建單後返回本人頁均已驗證。平台 OA 接受六筆本人測試訊息，包含修正後的 A READY；手機送達尚待确认。B 店現金收款、人工取餐、唯一交付及顧客完成畫面通過。新的 A 店 NT$30 Sandbox Request 等待本人手機授權；Confirm／退款、鏡頭掃碼與正式啟用未完成。**隔離部署不等於外部或正式驗收完成。** 詳細時間序列見 [執行紀錄](PREVIEW_EXECUTION_20260928.md)。

## Phase 0：真實架構與差距

最新缺陷修正範圍：本人原結帳成功頁導向私人訂單；僅因已確認時段變更而撤銷的有效 QR 可由完成通知恢復；付款入口依該訂單的店別 Sandbox Connection 判定，保留既有付款查核。三項均有先失敗後通過的聚焦回歸，並在新 Preview 驗證：B `260928-002` 原點餐→本人頁且無 Pay 按鈕；A READY worker 自動發行 QR v2 並由 LINE 接受，沒有先操作顧客更新 QR。

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
| 0 | 真實 repo 盤點、官方 Pay v4/Messaging/MINI 查核 | 平台 OA、Provider、MINI三環境及 Pay Sandbox 已讀回；實際登入／通知 API 已驗，付款授權未完成 |
| 1 | ADR、七份相容 migration、FORCE RLS | 本機 clone 與 PR365 data-less child 已套用；未套 Production/DR |
| 2 | 登入交換、會員條款/選填同意、好友事件、本人跨店訂單、歸戶 | 真人登入／同意／好友查核／A/B 列表／原結帳返回本人頁通過 |
| 3 | 原事件→outbox→固定平台 OA adapter、舊渠道隔離 | 遠端 worker 與六筆真實 API 接受通過，包含修正後 A 完成通知；手機送達待驗 |
| 4 | 真 PNG、preview、明確交付、唯一事件/Billing | B 店未付款拒絕、合成現金收款、人工取餐與重放通過；相機／LINE 快取待實機 |
| 5 | Sandbox-only v4、durable operation、UNKNOWN、退款/查核 | 真 Request 及逾時取消查核通過；本人授權、Confirm、退款未驗；LIVE 不可用 |
| 6 | 平台/門市看板、用量/補發、金流操作、Rich Menu 工具 | 只有 dry-run，無 provider apply |
| 7 | 94 項矩陣及 G 組逐項記錄 | BLOCKED/NOT_RUN 不算 PASS |
| 8 | 營運/安全/回復/外部設定與整合審查 | 尚未達正式啟用關卡 |

- 本機 DB `127.0.0.1:55722/stallorder_line_miniapp_20260926` 與 3023 共用容器但不是同一 DB；另有授權的 PR365 child `gfoscoqwumwdtvkbfoiv`。保留合成 fixtures，不複製至正式。
- 3024 為臨時 HTTPS 合成 QA，假 Channel、自簽憑證，不能驗真 LINE；3023 人工環境保留。最終程序狀態見 TEST_REPORT。
- 平台 OA「攤點通」`@028sijlm`，Messaging Channel `2011762548`／Provider `2005461563`；測試 Webhook、Vault 與 worker 已設定，已發出本人測試訊息。OA 尚未認證，未加購方案。
- LINE Pay Sandbox Channel `2011753464` 僅綁 A 店 DIRECT 收款；真 Request 已接受 NT$30，未經本人授權而逾時取消，不能當作付款成功。B 店仍缺第二個 Sandbox 商家。
- Developing `2011762558`／LIFF `2011762558-AZbWkGcb` Endpoint 為公開隔離站 `/mini`，已連平台 OA、openid/profile 與一般加好友提示。Review／Published 維持預設頁；MINI 仍為 Unverified，沒有正式發布。
- 單一入口：https://stallorder-line-v2-pr365-20260928.vercel.app 。9/29 06:24 開始清理、最晚 07:24 完成，US$2 管理預算不延長。本機 3023 保留人工 QA；正式及 DR 未變更。缺項集中在 [外部清單](EXTERNAL_SETUP_CHECKLIST.md)。
