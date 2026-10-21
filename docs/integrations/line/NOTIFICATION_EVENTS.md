# 平台 OA 通知事件與維運

本次為本機候選實作，尚未向真實 LINE 發送或發布。平台沿用 `notification_jobs`，新增 `delivery_mode=PLATFORM_OA` 分支；租戶舊通知保留 `LEGACY`。平台 OA registry 每環境只能一筆，由平台管理員同步伺服器設定的 Vault reference，商家不能指定 sender、recipient、任意模板或憑證。

| 事件 | 真實來源 | 發送條件 |
|---|---|---|
| ORDER_RECEIPT_AVAILABLE | 原訂單 owner 同交易綁定、CONFIRMED 或付款狀態更新 | 已成立且付款結果可解釋；未付款只呈現待付款，活躍 LINE Pay 未知結果先停止 |
| ORDER_READY | 原 orders.status 轉 READY 的同交易 trigger | 整單仍為 READY、未核銷、未退款 |
| ORDER_PICKED_UP | 核銷交易新增 LINE_PLATFORM_PICKED_UP order_event | 存在實際交付事件；泛用 COMPLETED 不會替代此事件 |
| ORDER_CANCELLED | 原 orders.status 轉 CANCELLED | 發送前仍為 CANCELLED |

會員 owner 在原下單 transaction 綁定，固定 environment/provider/subject hash。通知收件人是每單不可變 Vault reference；更新會員或舊綁定 callback 不得轉換既有訂單。資料庫拒絕把平台 owner 的訂單綁到 merchant OA，平台訂單的舊 enqueue 會被抑制。未啟用門市及 cutover 前訂單不會套用新流程。

所有事件都有環境、sender、order、event/version、recipient 的去重身份，並保留舊 unique 約束以相容既有 callback。Runtime 旗標停用會停止平台 Push，不刪除付款、核銷或待處理事件。

## 好友與同意

固定 `/api/webhooks/line-platform` 先以平台 secret 驗證原始 bytes 的 signature，再驗證 destination。只接受 user follow/unfollow 的 timestamp、event ID 和 subject hash；群組訊息不查詢訂單。receipt 與資料最小化事件同 transaction 落庫，回覆後可重新處理；相同事件去重、舊事件不覆蓋較新觀察、同 timestamp 以 unfollow 為準。尚未建立會員時也能記住好友事件。

好友未知、取消好友或封鎖，不等於已拒收的確定 provider 結果；worker 以 `FRIEND_NOT_CONFIRMED` 停止。後續有效 follow 只恢復 24 小時內、尚未發送且現在仍適用的成立／READY 事件。會員不同意、撤銷身分或停用也會在發送前停止。

## Push 操作與恢復

- 首次 I/O 前固定收件人、完整 JSON bytes、UUID retry key、payload hash、first_request_at、template version。完整 body 使用平台資料金鑰加密；資料庫 trigger 禁止更改已建立的快照。商家與一般 authenticated 角色不能 SELECT 快照或收件人 reference。
- 每次恢復使用相同 bytes 與 key。HTTP 2xx 只記 `PROVIDER_ACCEPTED`。409 必須同時具官方已接受訊息與 `x-line-accepted-request-id` 才視為原操作已接受。其他 409 不是成功。
- timeout、408、5xx、速率 429 有界退避；最多六次。400/401 等永久錯誤停止。配額 429 暫停共用 sender。從首次 request 起滿 24 小時或結果無法安全恢復，转 `MANUAL_REVIEW`，不換新 key。
- 90 秒租約透過 `SKIP LOCKED`、UUID fencing 及條件更新保護。過期工作可接管，舊 worker 不能回寫接受結果。第六次即使在建立快照前中斷，也會轉人工並清除租約與排程；舊的不可取得重試列一併收斂。I/O 前再次檢查會員、好友、門市、付款與 READY 有效性。
- 成立／READY 外帶快照另核對原圖片的 credential 身分、門市、有效期及履約時間版本。取餐碼重發、撤銷或改期後，舊快照转 `MANUAL_REVIEW / PICKUP_SNAPSHOT_STALE`，不送出、不改 body/key，亦不開放人工重試；顧客由訂單詳情取得最新取餐碼。
- 每批先以固定 LINE bot/info 比對平台 destination，避免錯 OA access token 誤送。配額每五分鐘查詢；未能確認 sender 或配額時 fail closed。保守預留每批 claim 數量，避免並行超用。
- 同一 sender 每秒最多一批、每批最多 20、同門市每批一件且 READY 優先；其他門市可以前進。最近事件与錯誤都可依門市歸因。

資料庫 commit 後 pg_net 喚醒既有 cron endpoint。只有非 local 且 registry worker origin 與 Vault 中原 report endpoint 完全一致才允許 HTTP。local worker 必須明確執行，絕不自動使用 clone 中的遠端 URL。pg_cron 五秒恢復只在 cron 自己的 database 安排；clone 不排程。遠端部署須另驗證 cron、pg_net、認證與實際延遲，不以本機函式測試當作自動喚醒成功。

## 營運介面

平台管理員 `/admin/line-platform` 可看共用配額、暫停、最近 100 筆通知、門市 rollout 並同步 registry；商家 `/merchant/{stallSlug}/notifications` 只看授權門市。中文顯示「LINE 已接受」，不宣稱送達或已讀。

安全重試須具有原門市權限、CSRF、原因，沿用原 job/key/body；每五分鐘一次、最多三次。只接受 FAILED／QUOTA_BLOCKED／SUPPRESSED 且當下仍有效的事件。未知結果、已接受、超窗、過時 READY 不能用此按鈕重發。每次操作寫 audit；不發生付款或履約副作用。

## 本次證據與缺口

2026-09-27，隔離 clone `127.0.0.1:55722/stallorder_line_miniapp_20260926`、四份 v2 migrations；通知測試只用新合成 fixtures，所有 Push 為 injected transport，全域 fetch 拒絕真實網路。

| Prompt 案例 | 本次狀態與證據 |
|---|---|
| F01、F04、F05 | 本機 PASS：兩門市同 OA/各自卡片、唯一 enqueue、過時 READY 抑制 |
| F06、F07、F08 | 本機 PASS：READY/outbox 同交易 rollback、過期租約、舊 worker fencing、timeout 原 body/key→409、快照不可改、24h 人工 |
| F09、F10 | adapter/contract PASS：400/401/409/429/503 分類；UI 文案只稱接受；真實封鎖接收情況未測 |
| F11、F12 | 本機 PASS：A backlog/READY 優先仍讓 B 前進；同時人工重試僅一次、跨店拒絕、同 key/body，已接受不能重試 |
| F13、F15 | contract/API PASS：正確門市/網址/Emoji、跨來源圖片拒絕、非 admin/非成員/無 CSRF/任意 to/sender/template 拒絕 |
| F02、F03、F14、F16 | 部分本機證據：DB事件/後端worker/舊渠道隔離存在；真實 OA 閉頁 Push、完整三階段、LINE舊快取QR、停啟切換實機回歸 NOT_RUN |
| E06、G | BLOCKED：未提供本次授權的真實 OA／LINE 裝置與自有公開 HTTPS 測試；不聲稱實機送達或完整完成 |

測試入口：`messaging.test.ts`、`notification-contract.test.ts`、`notification-routes.test.ts`、`notification.integration.test.ts`，以及既有 cron/job processor/LINE provider regression 和 `notification-job-scope.test.ts`。初次集中執行結果 8 files / 45 tests PASS；後續新增第六次快照前中斷、原訂單四個時間欄位優先序、500 後 QR 重發等七項案例，最新真 DB integration 17/17 PASS。QR 重發案例驗證原 media 失效、第二次不呼叫 Push、body/key/hash 不變並停止重試。舊 worker 的 candidate 選取及實際發送前都排除平台 owner，涵蓋舊排隊工作與切換交錯；另驗證錯 OA token 拒絕與未知 quota response 不被當作無上限。整合測試須明確設定 `LINE_PLATFORM_TEST_DATABASE_URL`，只接受上述精確 loopback clone，不 fallback。

官方規格：[retry key 與 24 小時限制](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)、[Messaging API reference](https://developers.line.biz/en/reference/messaging-api/)、[pg_cron seconds intervals](https://github.com/citusdata/pg_cron)。以 AnySearch 先行查核。
