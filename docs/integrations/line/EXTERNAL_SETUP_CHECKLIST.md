# LINE v2 外部設定清單

更新：2026-09-28，Asia/Taipei。缺項集中於此。欄位只列名稱，不放Secret/OTP。狀態須分開：程式、自動化、真實OA、Pay Sandbox、實機、認證及正式。當日控制台與官方 API 收據見 [帳號設定驗證](PROVIDER_SETUP_RECEIPT_20260928.md)。

最新增量（13:48 台北）：`9ac47b9` 完整 CI 通過，保留真實會員的 paired workflow 明列 SKIP。公開單一 alias 指向 `dpl_EQfj2fzij4qQg4WMWcKHgVT6UFPN`／sin1，Push及Pay旗標只在此隔離站開啟。真LINE登入、本人會員／通知同意、官方好友查核及第一筆本人訂單建立已驗證；送單後舊追蹤頁失敗已有本機修正，待新候選。該單於接單期限後EXPIRED，尚未發訊或付款。仍缺真通知接受／裝置送達、Sandbox完整交易及實機掃碼；B店缺第二個Sandbox商家，正式未啟用。各節早期未部署／等待2FA為歷史狀態，以 [最新執行紀錄](PREVIEW_EXECUTION_20260928.md) 為準。9/29 06:24起清理、最晚07:24到期，不自動延長。

## 1. 攤點通平台 OA 及合法營運資料 — OA/API已建立；通知流程待驗

14:18 增量以此為準：已完成同一真會員的 A/B 訂單，平台 OA 接受 A 訂單卡及 B 訂單／READY／PICKED_UP 訊息；尚缺本人手機確認送達。B 的合成現金收款與人工取餐通過，鏡頭掃碼尚未進行。A Sandbox 已 Request，但未經本人授權而官方逾時取消，後續待本人配合新交易的授權／Confirm／退款。B 仍沒有第二個 Sandbox 商家。到期、預算及不發布正式的邊界不變。

- 負責角色：平台擁有者／OA管理者。
- 控制台：LINE Official Account Manager https://manager.line.biz/；LINE Developers https://developers.line.biz/console/。
- 2026-09-28已確認：依使用者逐項條款／資訊使用／API授權建立「攤點通」`@028sijlm`，Messaging Channel `2011762548` 綁定既有 StallOrder Provider `2005461563`。`bot/info` 精確讀回相同 OA ID 與名稱；訊息格式驗證 HTTP 200。輕用量方案額度200、用量0；未發送測試訊息，OA尚未認證。
- 已核准建立通知存取權杖，OA Secret／Token存於repo外私密目錄，ACL僅本機擁有者與SYSTEM；沒有存登入密碼。bot destination已安全保存，未寫入前端／Git／Production。
- 欄位：平台OA顯示名/basic ID/bot userId、Messaging Channel ID、Provider ID、管理人、目前Bot/webhook、方案/配額、OA驗證狀態；平台實際法人/客服/會員條款/隱私/退款政策。
- 待辦：合法營運主體與公開政策、測試顧客好友／通知同意、HTTPS Webhook與Vault匯入；目前Webhook尚空，預設歡迎／自動回應仍開啟，尚未發布自訂歡迎訊息或選單。不升級方案。
- 完成驗證：bot/info精確destination；好友webhook簽章/重送；A/B店都由同一平台OA送測試訊息。
- 阻擋：真實端到端通知、對外條款、平台認證及正式啟用。API可驗證格式不代表訊息送達。
- 回復：保存原webhook/Bot/選單來源，先停止新Push，不清除待發證據。

## 2. MINI App／LINE Login／各環境設定 — Channel已建立；HTTPS與真登入待驗

- 角色：同Provider管理者／認證申請負責人。
- 位置：Developers該Provider各Channel，Developing/Review/Published、LIFF、linked OA、tester設定。
- 2026-09-28已確認：使用者確認MINI條款、台灣地區／代表權聲明並同意提交後另出現的MINI資料使用同意書，已建立「攤點通」Taiwan／Unverified MINI。Developing `2011762558`／LIFF `2011762558-AZbWkGcb`；Review `2011762559`／LIFF `2011762559-2vU9KSSA`；Published `2011762560`／LIFF `2011762560-0xmjKlDS`。同屬Provider `2005461563`。
- 已儲存並讀回linked OA `@028sijlm`、scopes `openid, profile`、Add friend `On (normal)`；未開啟 `chat_message.write`，未申請email權限。三個Endpoint仍是LINE預設頁，未發布服務、未送認證，也尚無可供顧客驗收的真實入口。既有LINE Login Channels `2011580550`／`2011201000`維持原樣。
- 官方台灣頁目前允許先建立／開發 MINI；Certified Provider 是台灣 Verified MINI 送審條件，不直接視作 Developing 建立門檻。官方Policy仍有不同步文字，資格差異與認證所需資料見 [台灣申請查核](TAIWAN_MINIAPP_REQUIREMENTS_20260928.md)。不使用普通 Login＋LIFF冒充MINI。
- 欄位：Provider ID、每環境Channel/LIFF ID、scope、Taiwan region、Endpoint/callback、linked平台OA、tester、Certified Provider、Verified MINI App各自狀態。
- 待辦：受控HTTPS Preview的精確`/mini` Endpoint、測試者角色、真實條款與隱私網址。現有repo採data-less Supabase Branch＋Vercel Preview，沒有常駐Staging網站；不得指向DR或正式站。OA認證、Provider認證及MINI認證不可相互替代。
- 完成驗證：真LINE首次/重複登入、不同audience拒絕、深連結、帳號切換、失去Session返回；兩種手機版本記錄。
- 阻擋：真身分/永久連結/實機/正式；普通OA Push不以缺Service Message模板作理由。
- 回復：保留各環境原設定，錯audience硬拒绝，不拿Published設定供Preview。

## 3. LINE Pay Sandbox — 帳號／唯讀API連線通過；付款流程待驗

- 角色：授權測試商家管理者／收件信箱擁有者。
- 位置：https://pay.line.me/portal/tw/auth/login → 開發者工具 → 管理連結金鑰。
- 2026-09-28證據：沿用既有官方測試帳號重新登入、完成郵件OTP，取得 Sandbox Channel `2011753464`。依授權將既有Secret存於repo外受限目錄。簽章 `GET /v4/payments` 以全新探測orderId查詢，HTTP 200／`1150 Transaction record not found.`；這是唯讀連線證據，沒有建立交易。**不需要重新申請同一測試帳號。**
- 欄位：Sandbox Channel ID/Secret、merchantReference、credentialVersion、正確店別Connection、API v4、currency TWD、callback origin；Secret只存安全設定。
- 待辦：匯入隔離server的店別版本化secret、公開HTTPS callback與真正Request／Confirm／退款。此通路是官方測試帳號，不能当作正式越好吃線上收款資格；正式QR收款商店未操作。
- 完成驗證：B01真Request→LINE授權→Confirm；19位ID、取消/返回、查核、UNKNOWN與退款，核對原店收款。
- 阻擋：Pay Sandbox；不阻擋Mock/資料庫/現金履約回歸。
- 回復：停新PAY保留原憑證版本/attempt/UNKNOWN，沒有不明退款再送一次的捷徑。

## 4. 各店正式收款及雙店試點 — BLOCKED

- 角色：越好吃一中店、第二家授權測試店之管理者。
- 位置：原商家 /merchant/payments、各店LINE Pay控制台。
- 欄位：Organization/Stall真實ID、LINE Pay線上資格/正式商家名、憑證版本、退款能力、店名地址電話/取餐點、授權店員、合作授權及cutover。
- 前置：雙店Sandbox及現金流程，沒有平台代收。商家不需交自己的Messaging token。
- 完成驗證：同一會員A/B兩店，同一平台OA，不同正確收款商家；A員工不能核銷B、看B消費。
- 阻擋：雙店真驗與正式收款；本候選只有Sandboxhost，LIVE需額外適配與QA。
- 回復：停個別店新單，處理既有未付/UNKNOWN/未交付，不搬動owner。

## 5. HTTPS／Vault／排程／監控 — BLOCKED

- 角色：平台維運。
- 位置：受控Staging/Preview Vercel、Supabase Vault/DB與Cron、既有Cloudflare/WAF。
- 欄位：HTTPS Endpoint、database fingerprint、32-byte資料金鑰、OA Vault UUID、callback/state secret、CRON_SECRET、worker origin及原report endpoint一致。
- 已確認：本機3024自簽與loopback PNG不能由LINE公開抓圖；clone無遠端scheduler，沒有寫Production。
- 2026-09-28準備：已核對 parent 所屬 Pro 組織及僅有 main 分支；本機 Preview workflow 改為付費組織可新建的 Micro，30項流程契約測試通過。後續已獲24小時隔離測試授權、建立PR #365與child gfoscoqwumwdtvkbfoiv；72 SQL／1,619 pgTAP已通過首輪，但整體CI／部署仍未完成，詳 [執行紀錄](PREVIEW_EXECUTION_20260928.md) 及 [資源方案](SETUP_RUNBOOK.md#2026-09-28-公開測試資源方案尚未執行) 與 [成本](PREVIEW_RESOURCE_COSTS_20260928.md)。
- 2026-09-28增量：配對Preview `36360718506` SUCCESS，1,619 pgTAP、read-only及合成OAuth/delivery smoke通過；部署仍受Vercel登入保護，瀏覽器等待2FA。完整CI另有2項舊導覽案例失敗，修正後本機聚焦通過，尚待新HEAD完整CI；沒有匯入OA／Pay憑證或公開網址。
- 完成驗證：Webhook原bytes/簽章、media合法抓取、private no-store、CDN/APM URL遮罩、pg_net commit wakeup、worker lease重啟與首次Push延遲、Pay每分鐘查核。
- 阻擋：真OA圖片/背景時效/實機/正式。
- 回復：保存Primary健康artifact與映射，不影響DR，遵守Staging→Production與单一writer。

## 6. 裝置與外部验收 — BLOCKED

- 2026-09-28 12:50：本人已建立真LINE會員並同意通知；Chrome實際回到會員頁。已重現「Webhook啟用前既有好友」未同步，正補官方API查核，公開修正及真實訂單訊息仍待驗。此登入證據不能代替Sandbox付款或實機掃碼。

- 角色：授權測試顧客A/B及兩店員。
- 需求：iPhone LINE、Android LINE、Safari/Chrome、獨立店員掃碼裝置；記OS/LINE版本、時間/環境及遮罩證據。
- 腳本：首次入會/好友→A店付款/卡片→關MINI→READY訊息→另機掃码preview→交付→已取餐；B店再跑；拒好友/封鎖/重掃/跨店/過期/相機拒權/弱網/長文/明暗。
- 已確認：本機Chromium合成Session與PNG解碼不是上述實機證據；歷史OPPO通知測試不沿用為本次LINE驗收。
- 阻擋：G組與正式啟用。
- 回復：測試資料保留於授權測試環境，不做真實扣款/退款冒充Sandbox。

## 7. 選單發布、認證與正式启用 — NOT_RUN

- 角色：平台OA管理者／發布負責人。
- 位置：OA Manager/Developers、RICH_MENU_OPERATIONS、專案Staging/Production流程。
- 欄位：原Manager/API/per-user選單與備份、policy/plan/hash、真實LIFF manifest、歡迎訊息、配額、OA/Provider/MINI各別審核狀態。
- 已確認：只產本機資產，publishable=false；沒有apply/restore、沒有認證申請完成、沒有正式deploy。
- 完成驗證：真選單四入口、sender/readback、逐項G證據、Primary可用性及回復target；需具體發布授權。
- 阻擋：選單對外/認證/正式。不自動加購，也不將控制台登入當認證通過。
