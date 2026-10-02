# 2026-10-02 整合候選的 DR 資料表分類

本文件是程式契約與待發布驗證清單，不是 DR 已同步或正式切換成功的收據。發布使用固定候選的 migration、publication 與 subscription 回讀；不得以舊測試或本機 PASS 代替。

## 持久資料：Primary → DR

`scripts/lib/dr-replication-scope.mjs` 明列 144 張持久 public 表。本輪補足下列 9 張新表：

| 資料表 | 必須保留的狀態 |
|---|---|
| `line_platform_members` | 平台會員、Provider 身分邊界、同意／撤銷紀錄及加密 subject。 |
| `line_platform_stalls` | 門市資格、環境及 cutover 時間；不得於 DR 各自重建資格。 |
| `line_platform_order_owners` | 原訂單的會員歸屬與平台取餐要求。 |
| `line_platform_member_audit` | 加入、同意與撤銷相關證據。 |
| `line_platform_friendships` | 對指定 sender 的好友／封鎖狀態與已處理事件證據。 |
| `line_platform_pickup_credentials` | QR 版本、有效期限、撤銷與核銷結果、冪等證據；加密內容與其 hash 一起保留，避免切換後復活舊 QR。 |
| `notification_read_receipts` | 個別會員對原通知來源的已讀紀錄。 |
| `notification_preferences` | 可見分類、分析同意與版本；不得切換後恢復已撤銷同意。 |
| `product_feedback` | 與既有 profile／organization／stall 關聯的回饋紀錄。 |

本輪已分類的治理表仍複寫：`privacy_policy_versions`、`privacy_requests`、`privacy_request_events`、`privacy_exports`、`retention_policy_versions`、`privacy_legal_holds`、`privacy_deletion_tasks`、`privacy_deletion_tombstones`、`security_support_grants`、`security_incidents`、`audit_archive_outbox`。這是保留權利履行與撤銷證據，不等於開啟治理能力。使用者延後外部法律／MFA／archive 設定，`COMPLIANCE_ENABLED=false`、`COMPLIANCE_DELETION_DRY_RUN=true` 保持生效。

## 環境限定：不進入 publication

| 資料表 | 原因及限制 |
|---|---|
| `backend_runtime_state`、`replication_health_snapshots` | 各環境自己的 writer／promotion 與觀測狀態。 |
| `security_step_up_grants` | 環境本地一次性高風險授權；切換後重新取得證明，不搬移 grant。 |
| `line_platform_payment_attempts`、`line_platform_payment_operations` | 本版只接受 local／preview Sandbox；含 return state、callback origin、credential reference 與 lease。正式 `paymentRuntime()` 必定拒絕 Sandbox，不能複寫後當成正式收款資料。未來 LIVE Pay 必須另行設計切換、冪等及 reconciliation 契約。 |

上述 sandbox 排除不是把原 `orders`／`payments` 帳本排除，也不是允許在正式資料庫建立 Sandbox 單。本輪不改動既有收付款 ledger 的發布範圍。

## 複寫資料不等於複寫憑證或 provider 能力

- 不新增 Vault、Auth schema 或伺服器 secret 的複寫。`profiles.auth_user_id` 原有欄位排除保持不變。
- LINE 會員及 QR 密文使用 `LINE_PLATFORM_DATA_KEY`，保留完整密文是為了保留原證據。DR 要實際解密與發訊，必須另外驗證正確的 Production key、Provider／Published Channel／OA destination 及環境 binding；資料表存在不能證明具備能力。
- 既有 `notification_integrations` 已在持久清單，其 Vault reference 不是 DR 可用 secret 的證明。OA Token／Secret 必須以獨立秘密管理程序配置與 readback，不能把 Primary Vault 直接複寫或從本機測試檔帶入。
- 現行 `assertPlatformDatabaseTarget()` 比對實際資料庫 fingerprint；Primary 的 `LINE_PLATFORM_DATABASE_BINDING_JSON` 不能直接沿用到 DR。現有 cutover helper 沒有自動處理 LINE binding／data key，因此 LINE provider continuity 尚未驗證。沒有完成設定時保持平台相關能力停用，不能為讓切換通過而放寬 fingerprint 或 environment guard。
- Primary → DR 是同一正式環境的災難復原，不能把 Preview 身分、Sandbox 金流、Developing Endpoint 或測試 OA 設定提升為正式。

## 程式回歸與發布驗證

`scripts/lib/dr-replication-scope.test.mjs` 直接讀取本輪治理 migration 及 2026-09-25 之後的 migration，要求每張新建 public 表只屬於持久或環境限定其中一類；未分類的新表使測試失敗。另驗證 QR／會員／通知／回饋完整 publication、Sandbox／step-up publication 拒絕，以及現行 Sandbox 與資料庫 fingerprint 防線仍存在。

本輪靜態契約驗證：`npx vitest run scripts/lib/dr-replication-scope.test.mjs scripts/lib/dr-failover-operations.test.mjs scripts/configure-dr-replication.test.mjs`，3 檔、14 測試 PASS。dry-run 子程序無資料庫連線；未做遠端變更。

發布前仍需新 DR Plan、目標身分及兩端 schema 相容性驗證、持久新增表 PK／目標空表檢查、精確 publication／subscription 回讀及同步證據；應以真實切換負案驗證訂單歸屬、已核銷 QR 不復活與通知撤權。這些未由本文件或單元測試完成。
