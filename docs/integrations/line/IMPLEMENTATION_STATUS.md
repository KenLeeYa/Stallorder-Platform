# LINE 整合進度（2026-09-26）

需求來源：完整閱讀 `QIDAIGO_LINE_MINIAPP_LINEPAY_CODEX_PROMPT_v1_20260922.md` 754 行。文件為需求，不能用其範例當成已驗證的程式或外部授權。

本次交付是第一批可審查基礎，不是 Phase 0–8 全部完成。已加入真正可送出簽章 HTTP 的 Sandbox transport（測試以 fixture 攔截）、MINI ID-token verifier、環境綁定檢查與公開永久連結限制。10 檔 71 tests PASS；詳見 [測試報告](TEST_REPORT.md)。本輪已追加 MINI 登入 API／Session 與未啟用的入口殼層；付款仍未開放，未執行外部交易。

使用者已確認 MINI 測試 Channel 與 LINE Pay Sandbox 存在，稍後提供安全設定位置。外部驗證等待設定；同時仍有下表列出的未實作程式，不能將其全部歸因於缺憑證。

候選：`codex/line-miniapp-pay-20260926`，基底 `766df1e217f9418739f6f907e9f4113fd02e3436`。獨立工作樹 `C:/Users/KY/.codex/worktrees/line-miniapp-pay/Stallorder-Platform`；原 3023 UI 候選及未提交修改保留。沒有部署、正式資料寫入、外部訊息、收退款、Channel 或選單變更。

## 盤點

| 需求 | 現有能力／真實來源 | 缺口／擬修改與驗收 |
| --- | --- | --- |
| 店家、訂單、庫存、計費 | `prisma/schema.prisma` Organization/Stall/Order、既有 public-order/service 與 Billing | 重用，不新建核心；MINI App 不可自行改金額或計完成單 |
| 商家登入 | 既有 OIDC、Google/LINE/Apple 與 session；`src/server/notifications/line-oauth.ts` 是訂單通知 OAuth | 已加一次性 browser-bound challenge，沿用既有 Session；普通 OAuth 與 MINI flow 互斥 |
| 顧客 LINE | `CustomerContactLink`、`LineLinkSession`、`LineWebhookEvent`；通知文件 `docs/LINE_NOTIFICATIONS_AND_REORDER.md` | 現有是訂單範圍連結，非跨訂單 MINI App 會員 session。跨 Provider 身分與通知映射需分開設計 |
| 金流 | `PaymentProviderConnection`、`PaymentProviderTransaction`、`PaymentProviderRefund`、`PaymentReconciliationCase`；`src/server/payment-providers/*` | LINE Pay registry 目前返回 ContractOnly；Mock 流程不能拿來上線 |
| 網路付款帳本 | `src/server/online-payments/*`、`docs/ONLINE_ORDER_PAYMENT_RECONCILIATION_ADR.md` | 目前限定 LOCAL_MOCK 與其 HMAC 事件；不可假裝 LINE Pay 有相同 webhook |
| 精度／簽章 | Node 24 runtime；現有 provider contract 的 transaction ID 為 string | 增加 LINE Pay v4 專用 transport；原始 JSON source 無損處理；API 回應與狀態 fixture 驗證 |
| 不確定付款／退款 | 現有 Mock 及 reconciliation case | 缺 durable Request/Confirm/Refund lease、憑證版本快照、未知結果保留及真實對帳 integration |
| 取餐通知 | 既有 OA Messaging provider、Vault、notification job processor | MINI Service Message 需 Channel／認證／template／token rotation；缺官方設定，不啟用 |
| POS/KDS/列印 | 既有 staff checkout、order event、print job | 付款事件須接既有 outbox，不能把 adapter 成功直接等同完成單 |
| 試點 | 文件指定 `/store/viet-food-yc` | 正式 Organization/Stall 與商家 Pay 所有權尚未讀回，不硬編碼店名授權 |
| 外部配置 | 尚無本次提供的 MINI App/Pay Sandbox 設定或商家資格證據 | 已詢問安全設定位置；狀態為未取得，不宣稱帳號不存在 |

## 階段

| Phase | 本輪狀態 | 尚缺 |
| --- | --- | --- |
| 0 | 進行中：程式／官方協定盤點 | 全部 baseline、試點 Provider/Channel 對照 |
| 1 | 部分完成：[ADR](ARCHITECTURE_DECISIONS.md)、server-only binding schema | 真實映射、tenant-scoped immutable attempt + operations migration |
| 2 | 部分完成：ID Token server verify、browser-bound challenge、Session、SDK 殼層、公開連結 | 既有顧客訂單授權整合、真實 Channel／SDK 成功流程；殼層與 Session/challenge 已實作 |
| 3 | 部分完成：v4 Request/Check/Confirm/Details/Refund transport 與 regression | 既有 checkout／durable operation／安全 callback；尚未接收款入口 |
| 4 | 未完成 | durable unknown/refund/reconciliation + order/outbox integration |
| 5 | 未完成 | Service Message、選單工具與真實 OA 驗證 |
| 6 | 未完成 | 後台、完整跨租戶／安全與 migration 驗證 |
| 7 | BLOCKED（外部）／其餘待測 | Sandbox 憑證、LINE 手機、Preview Channel；fixture 不等於真實通過 |
| 8 | 七份文件初版完成 | 持續更新真實整合／實機／發布證據，不能將此表稱為全部完成 |

不得啟用正式 LINE Pay。原 3023 是 UI 人工測試環境；本工作樹已改為獨立 node_modules（LIFF 2.31.0），使用同機既有 DB 容器內獨立資料庫 stallorder_line_miniapp_20260926。migration 僅套於這份 clone；3024 是短暫 QA 程序，驗證後停止，3023 保留。

## 同日第二批：登入交換與設定準備

- OAuthTransaction 加 flow/contextFingerprint，以同一交易鎖及 Session 建立流程消耗 challenge；標準 callback 拒絕 MINI flow。
- 跨 origin、瀏覽器 secret、時效、Channel fingerprint、並行與重放驗證；MINI 不連結或登入具有商家／平台權限的身分。原始 ID Token 不落資料庫。
- 75 個原本選取 regression 加 3 個 runtime 設定案例，共 78 PASS（包含 8 個 real-local-DB/provider-fixture cases）；2 個本機 browser PASS。不是真實 LINE 成功證據。
- 設定引導見 [商家逐步指南](MERCHANT_SETUP_GUIDE.zh-TW.md)。使用者要求詳細步驟，目前安全交接檔仍空白。
- Phase 3–6 付款持久化／私人訂單所有權／通知／後台等仍需實作；不可因憑證待填就當成其餘已完成。
