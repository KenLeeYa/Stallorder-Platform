# 平台 LINE Pay 付款與退款操作

更新：2026-09-27。狀態：本機隔離候選；真實 LINE Pay Sandbox、裝置與正式收款尚未驗證。平台 OA 不參與收款，各訂單由其既有 Stall 的 LINE Pay 商家連線收款。

## 既有核心與新增資料

沿用 `payment_provider_connections`、`payment_provider_transactions`、`payment_provider_refunds`、`payment_reconciliation_cases`、原 `payments` 和 `orders`。不使用 SaaS 訂閱的 PaymentAttempt，也不擴充另一套只限 LOCAL_MOCK 的 `online_order_payment_intents`。

新增 migration `20260927040000_line_platform_payment_operations.sql`：

- `line_platform_payment_attempts` 為既有 provider transaction 的一對一延伸，保存環境、商家憑證版本引用、Channel ID、穩定商家訂單號的關聯、高熵 return state 雜湊及 30 分鐘期限。憑證、原 state 不保存於資料列；Provider action URL 使用獨立設定金鑰 AES-GCM 加密。
- `line_platform_payment_operations` 持久化 Request／Check／Confirm／Refund 的操作鍵、租約、fence、結果與經驗證的金流摘要。每交易最多一個 IN_FLIGHT 操作；租約 90 秒。過期 mutation 轉 UNKNOWN，不重新發送。
- 同訂單最多一筆 REQUESTING／PENDING_AUTH／CONFIRMING／UNKNOWN／MANUAL_REVIEW；原訂單為鎖定起點，退款與取餐核銷也先鎖該列。未定付款阻擋改價、現金重付、取消、到期、完成，避免逾時直接釋放庫存或再次收款。
- 既有 Refund 增加 UNKNOWN；REQUESTED／PROCESSING／UNKNOWN 全部占用可退款金額。
- `20260927050000_line_platform_payment_recovery.sql` 增加 attempt 的持久化查核時間、次數、worker fence／租約及人工查核標記。

外部 I/O 一律位於 DB 交易之外：預留並提交 → 呼叫 LINE Pay → 短交易提交可信結果。付款成功寫入原 payment、order.payment_status 和 audit；既有 DB 通知／列印觸發器在同一提交看見 PAID。**不改 order.status／completed_at，不自行新增 Billing 使用費。** 完成單及全額退款沖銷沿用既有 trigger。

## 預設關閉及商家設定

新付款同時要求 `LINE_PLATFORM_ENABLED=true`、`LINE_PLATFORM_PAY_ENABLED=true`。目前 transport 只允許 `LINE_PLATFORM_ENVIRONMENT=local|preview`；VERCEL_ENV=production 或混用 Preview/local 會拒絕。沒有 LIVE endpoint。只關閉 PAY_ENABLED 會停止新付款，仍允許已存在交易的查詢、恢復及有權限退款；關閉 PLATFORM_ENABLED 會停止所有平台 API。

必要 server-only 設定：

- `LINE_PLATFORM_PAY_CALLBACK_ORIGIN`：固定 HTTPS origin，與回跳站台相符。
- `LINE_PLATFORM_PAY_STATE_SECRET`：至少 32 字元，用於加密 action URL；保留此版本直到所有舊付款返回完成，不擅自輪替。
- Preview 須另有 `LINE_PLATFORM_DATABASE_BINDING_JSON`，由共用 `assertPlatformDatabaseTarget` 比對獨立記錄的 environment／資料庫 fingerprint；誤指向其他 DB 會拒絕。Fingerprint 不包含密碼。
- 各店 Connection：provider LINE_PAY、environment SANDBOX、status ACTIVE、精確 Stall ID、enabledChannels 包含 PUBLIC_MENU，capabilities `{apiVersion:"v4",credentialVersion:"v1",partialRefund:false}`。若商家能力及驗收支持，才能啟用 partialRefund。
- `secretReference` 只接受版本化 `env://LINE_PAY_<名稱>_V<數字>`；該環境變數為 JSON，欄位為 `channelId`、`channelSecret`、`merchantReference`、`version`、`environment:"SANDBOX"`。版本與商家參照必須吻合 Connection。不要把真實值寫入文件或前端。

每 attempt 固定上述引用、商家、Channel ID 及 API v4；管理員更新連線後，舊交易仍讀原版本。移除舊版本會使恢復失敗，不能靜默改用新商家。此候選沒有自動建立商家資格、上傳憑證或啟用真實付款的管理操作。

## 顧客與商家入口

顧客 `/mini/orders/[orderId]` 可由 `LinePlatformPayButton` 呈現付款狀態；父頁只在授權的測試功能旗標下顯示。先讀 durable attempt，未知或進行中時不提供再次付款按鈕。

| API | 授權／輸入 |
|---|---|
| POST `/api/payments/line-pay/checkout` | 既有 Session、CSRF、會員訂單所有權；body `orderId,expectedAmount,orderVersion`，header `x-idempotency-key` UUID。金額及版本須與伺服器既有訂單吻合，租戶與收款帳號由 server 決定。 |
| GET `/api/payments/line-pay/order/[orderId]` | 本人查該單最新 attempt；no-store。 |
| GET／POST `/api/payments/line-pay/[attemptId]` | 本人讀狀態／以 CSRF 恢復。POST 可在首次授權完成後進行一次受控 Confirm。 |
| GET `/api/payments/line-pay/return`、`/cancel` | 高熵短效 state 與已知 transactionId/orderId 比對；無 OA webhook 簽章假設。只恢復指定 attempt，303 至乾淨受保護訂單頁。Cancel 只查證，不 Confirm、不直接標取消。 |
| POST `/api/merchant/payment-integrations/operations` | MANAGE_PAYMENT_INTEGRATIONS、精確店別及 CSRF。body `action:"RECONCILE",attemptId,stallId` 或 `action:"REFUND",attemptId,stallId,reason,amount?`；退款需 UUID 冪等鍵，省略 amount 由 server 算剩餘可退款額。 |
| GET `/api/merchant/payment-integrations/operations?stallId=…` | 相同商家權限，回傳該租戶／攤位／環境最近 50 筆付款、退款餘額及未結人工案件。 |
| GET `/api/cron/line-pay-recovery` | 既有 CRON_SECRET Bearer 驗證；每次至多兩筆，只查核既有交易。 |

商家 `/merchant/payments` 的「LINE Pay 付款查核與退款」區塊可選攤位、查核付款、查看人工案件及退款。退款須輸入原因並勾選確認金額；UI 預設剩餘全額，允許部分退款的商家才有金額欄位，server 仍重新檢查餘額與能力。退款請求與經驗證成功都寫入既有 AuditLog。回應不含 Credential 或 return state。

## 不明結果的處理

1. **Request 回應遺失／取得交易 ID 前崩潰**：UNKNOWN 保持原 attempt 及資源鎖。未取得可驗證交易 ID 時，不可新建另一筆 Request，也不可直接改現金；目前須透過商家控制台人工查核。公開查不到 completed details 不能證明 Request 不存在。
2. **Confirm 回應遺失**：先 Check。0000 保持等待、0110 只允許尚未有 Confirm 操作的 attempt 進首次確認、0121/0122 以查核結果結束未付款流程、0123 再讀完整交易並比對交易 ID／商家訂單／金額／幣別後修復。已存在 UNKNOWN Confirm 不盲重送。
3. **Provider 成功但 DB 提交失敗**：原 IN_FLIGHT 租約仍可追蹤；恢復查核成功後再原子入帳。若原單已取消、金額不同、已有另一 payment，保留外部 PAID 事實與 reconciliation case，標 MANUAL_REVIEW，不復活訂單、不丟棄超收事實。
4. **Refund 回應遺失**：保持額度保留，不再次 POST refund。RECONCILE 以原商家憑證 GET `/v4/payments`，核對原 PAYMENT，解析其 `refundList`：長 ID 保持字串、負 `refundAmount` 轉正退款額、合法 ISO 時間。僅一個未知退款、一筆未入帳的外部退款、金額相等、時間落在原請求前 1 秒至後 90 秒、所有舊成功退款皆存在，才將該金流事實配對完成。額外／重複 ID、金額或時間不符、未知型別、缺證據均保留 UNKNOWN，建立 `REFUND_RESULT_UNPROVEN` 人工案件。
5. 人工案件不提供「直接標已付／已退」捷徑。需受控取得足夠 provider 證據及補償決策；此候選沒有自動無憑據解除鎖定功能。

除顧客回跳／本人恢復及商家 API，付款 worker 以 `FOR UPDATE SKIP LOCKED` 原子領取到期 attempt，每次至多兩筆，租約 90 秒。每筆沿用原商家快照，僅允許 Check／Details，不能 Request／Confirm／Refund。新單開關關閉不會停止查核；整個平台關閉才停止。

未完成查核以 60 秒起指數退避，最多 1 小時；8 次仍未解決即建立人工案件。Worker 崩潰可在租約過期後領取，舊 fence 不可覆蓋新 worker 的結果。沒有交易 ID 或退款證據不足時轉人工並保留原款項／退款額度。付款專用 cron route 已實作，實際 scheduler 註冊與遠端執行需由主 Agent／環境部署紀錄證明；本輪沒有啟動外部排程或呼叫真實金流。通知 worker 與金流查核責任分開。

## 官方核對及測試證據

主 Agent 於 2026-09-27 以 AnySearch 查核 [Check](https://developers-pay.line.me/online-api-v4/check-payment-request-status)、[交易明細](https://developers-pay.line.me/online-api-v4/retrieve-payment-details)、[退款](https://developers-pay.line.me/online-api-v4/refund)。明細官方範例有重複退款 ID 與不合法時間示例，程式採 fail-closed，不複製其錯值。Fetch read timeout 25 秒，符合至少 20 秒要求；不自動重送 mutation。

- 聚焦 unit/API/protocol/migration regression：12 files／80 cases PASS；同一命令的 11 個 DB integration cases 由 opt-in guard SKIP，不當作通過。
- 另以 `LINE_PLATFORM_TEST_DATABASE_URL` 指定 loopback:55722、精確 clone `stallorder_line_miniapp_20260926`：最後審查修復後 **13/13 DB integration PASS**。包含並行冪等、19 位 ID 原付款入帳、UNKNOWN 阻擋重付、callback 恢復、部分退款上限、未知退款恢復／人工案件、商家快照、完成計費及全退唯一沖銷，以及 worker 重啟、舊 fence、持久化退避、無交易 ID 人工案件、撤銷 LINE identity／member 拒絕新付款但保留可信在途對帳。
- 最後審查補強 customer checkout/status 的 active owner 驗證後，customer／return／merchant／cron 聚焦回歸 **5 files／14 cases PASS**；詳見 `INTEGRATION_REVIEW.md` 的 R1。
- DB integration 使用實際 repository／SQL／adapter，但所有 LINE Pay HTTP 回應為合成 fixture，**不是 Sandbox 交易證據**。合成 fixture 保留在隔離庫；沒有啟動或停止本測試之外的服務。
- ESLint payment scope、全專案 typecheck PASS（本次時間點；整合修改由主 Agent 再匯總）。商家 UI 瀏覽器實際操作由主 Agent 驗證，不能以 API 測試代替。
- 真實雙店 Pay Sandbox、OA 與 iPhone／Android、獨立掃碼、真實商家資格、Production：BLOCKED／NOT_RUN。不得啟用 LIVE 或宣稱正式可收款。

執行 unit：`npm test -- src/server/payment-providers src/server/online-payments/online_order_payment_service.test.ts src/app/api/payments src/app/api/merchant/payment-integrations/operations/route.test.ts src/app/api/cron/line-pay-recovery/route.test.ts supabase/tests/auth_payment_provider_foundation_migration.test.ts supabase/tests/online_order_payment_migration.test.ts`。

執行 DB：僅在確認 clone 後，將同一已驗證本機連線設為 `DATABASE_URL` 及 `LINE_PLATFORM_TEST_DATABASE_URL`，執行 `npx vitest run src/server/payment-providers/line-platform-payment.integration.test.ts`。測試硬性拒絕其他 host／port／database；不要貼出連線值或改用 Production。

回復：關閉 PAY_ENABLED 停止新單，保留 schema、操作／退款紀錄及原版本憑證，繼續對帳與處理 UNKNOWN。不得用刪台帳、重置 DB 或取消所有未定單作回滾。

## 原流程有界回歸（2026-09-27）

詳細斷言、失敗原因與 prompt C11/C12/C13/E02/E03/E05 對照保存在 `artifacts/line-v2-core-pgtap-20260927.json`。隔離 clone 曾缺少原 migration 的 ACL、KDS 日期 helper 的預期 owner；僅依原文恢復 clone，紀錄在 `artifacts/line-v2-clone-baseline-repair.sql`，不是待發布 migration。

- 原 KDS pgTAP **32/32**、online payment reconciliation **46/46**、PAYG billing **39/39** PASS。測試修正僅限 fixture 隔離：PAYG 計數限定兩個 fixture 攤位、KDS 在 rollback 交易內清除既有已讀警報。
- 原 LINE notification/reorder **33 PASS、1 SKIP**：clone 沒有 `pg_cron`，執行時單獨將排程斷言標為 SKIP，其餘原測試繼續。讀權限斷言精確檢查公開狀態欄可讀、加密 snapshot 不可讀。
- Payment foundation **18 PASS、1 FAIL**：clone 既有七個 auth/payment flags 的 `default_enabled=true`，v2 未修改。未為通過測試切換旗標，不能當成 default-off 通過。
- 五個 SQL 測試皆完成明確 ROLLBACK，fixture 訂單／攤位讀回 0；原 ACKNOWLEDGED 警報仍在。瀏覽器角色無舊 payment RPC EXECUTE，notification snapshot 欄位仍不可讀。
- `fulfillment-event.integration.test.ts` **3/3 PASS**：真 KDS 指令併發、未開 KDS 的原 READY API 併發與重試、原單品 API 在 PACKING 下的部分完成，皆驗證唯一 READY 事件及通知工作。API 身分邊界為合成，CSRF、API handler、核心指令、DB 與 trigger 真跑；通知同意設 false，工作為 SUPPRESSED，fetch 呼叫 0。此證據不涵蓋真 LINE 發送、實體印表機、手機離線回連或真登入。
