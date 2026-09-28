# LINE v2 外部設定清單

更新：2026-09-28，Asia/Taipei。缺項集中於此。欄位只列名稱，不放Secret/OTP。狀態須分開：程式、自動化、真實OA、Pay Sandbox、實機、認證及正式。當日控制台與官方 API 收據見 [帳號設定驗證](PROVIDER_SETUP_RECEIPT_20260928.md)。

目前狀態（20:31台北）：85f441a為唯一公開隔離站版本，既有CI／CodeQL、候選6項／公開15項及真人退款頁已驗。A007真Sandbox付款／全額退款已驗。本人以iPhone 16 Pro／LINE 26.15.0完成B002實機QR交付、店員與顧客已取餐及平台OA取餐卡片送達，三張畫面與後端20:21:20核銷一致；iOS版本未提供。B002已完成，不能再作未交付fixture。其他七筆卡片手機送達、其他裝置邊界、部分退款、第二Sandbox商家仍待驗。歷史失敗保留在[執行紀錄](PREVIEW_EXECUTION_20260928.md)。9/29 06:24起清理、最晚07:24完成，不自動延長。

預算：使用者於18:19核准提高至US$3，原24小時期限不變，最後一次修正版已部署。Vercel18:26讀回本次期間的整個StallOrder專案Infrastructure US$1.68（含Primary與Build CPU US$0.38），加24小時Micro估算US$0.32256為較大範圍參考US$2.00256，**不是本PR實際費用或最終帳單**，資料可能延遲1小時。沒有新增訂閱；本次部署身分均列入原清理排程。

## 1. 攤點通平台 OA 及合法營運資料 — B002 取餐卡片實機送達通過；其他卡片待確認

- 負責角色：平台擁有者／OA管理者。
- 控制台：LINE Official Account Manager https://manager.line.biz/；LINE Developers https://developers.line.biz/console/。
- 已確認：依使用者逐項條款／資訊使用／API授權建立「攤點通」`@028sijlm`，Messaging Channel `2011762548` 綁定既有 StallOrder Provider `2005461563`。`bot/info` 精確讀回相同 OA ID 與名稱。平台 OA 已接受 A 訂單卡、B 訂單／READY／PICKED_UP 各一次；未加購方案，OA 尚未認證。建立時額度／用量為歷史基線，不作為目前用量。
- 已核准建立通知存取權杖，OA Secret／Token存於repo外私密目錄，ACL僅本機擁有者與SYSTEM；沒有存登入密碼。bot destination已安全保存，未寫入前端／Git／Production。
- 欄位：平台OA顯示名/basic ID/bot userId、Messaging Channel ID、Provider ID、管理人、目前Bot/webhook、方案/配額、OA驗證狀態；平台實際法人/客服/會員條款/隱私/退款政策。
- 已設定：本人好友／通知同意、隔離 HTTPS Webhook、Vault 與通知排程。預設歡迎／自動回應維持原設定，未發布自訂歡迎訊息或選單。
- 已補齊：B002 ORDER_PICKED_UP 實機卡片送達；單號260928-002、門市B、NT$30及20:21完成時間一致。一筆通知工作、attempt_count=2、SENT／PROVIDER_ACCEPTED，累計八筆OA API接受，不等同八筆手機畫面均驗證。
- 待辦：本人手機核對其餘七筆卡片的店名／金額／QR（A訂單／READY、B001三階段、B002訂單／READY）；正式合法營運主體與公開政策。A007退款後的QR撤銷；B002 v2已核銷，不再展示為待取餐範例。A時段變更後READY修正已有真worker證據，仍不以API接受代替手機送達。
- 完成驗證：bot/info精確destination；好友webhook簽章/重送；A/B店都由同一平台OA送測試訊息。
- 阻擋：其他通知階段的實機核對、對外條款、平台認證及正式啟用。B002已取餐通知有真實送達證據，其餘API接受不可等同送達。
- 回復：保存原webhook/Bot/選單來源，先停止新Push，不清除待發證據。

## 2. MINI App／LINE Login／各環境設定 — Developing真登入通過；實機及認證待驗

- 角色：同Provider管理者／認證申請負責人。
- 位置：Developers該Provider各Channel，Developing/Review/Published、LIFF、linked OA、tester設定。
- 2026-09-28已確認：使用者確認MINI條款、台灣地區／代表權聲明並同意提交後另出現的MINI資料使用同意書，已建立「攤點通」Taiwan／Unverified MINI。Developing `2011762558`／LIFF `2011762558-AZbWkGcb`；Review `2011762559`／LIFF `2011762559-2vU9KSSA`；Published `2011762560`／LIFF `2011762560-0xmjKlDS`。同屬Provider `2005461563`。
- 已儲存並讀回 linked OA `@028sijlm`、scopes `openid, profile`、Add friend `On (normal)`；未開啟 `chat_message.write` 或 email 權限。Developing Endpoint 已指向隔離公開站 `/mini`，真登入、會員同意與官方好友查核通過。Review／Published 保留 LINE 預設頁，未送認證。既有 LINE Login Channels `2011580550`／`2011201000` 維持原樣。
- 官方台灣頁目前允許先建立／開發 MINI；Certified Provider 是台灣 Verified MINI 送審條件，不直接視作 Developing 建立門檻。官方Policy仍有不同步文字，資格差異與認證所需資料見 [台灣申請查核](TAIWAN_MINIAPP_REQUIREMENTS_20260928.md)。不使用普通 Login＋LIFF冒充MINI。
- 欄位：Provider ID、每環境Channel/LIFF ID、scope、Taiwan region、Endpoint/callback、linked平台OA、tester、Certified Provider、Verified MINI App各自狀態。
- 待辦：法定條款／隱私網址與認證、iOS／Android LINE 內實際深連結、帳號切換／Session 失效返回。现有 data-less Supabase Branch＋Vercel Preview 已建立；不可指向 DR 或正式站。OA、Provider 與 MINI 認證不可相互替代。
- 完成驗證：真LINE首次/重複登入、不同audience拒絕、深連結、帳號切換、失去Session返回；兩種手機版本記錄。
- 阻擋：真身分/永久連結/實機/正式；普通OA Push不以缺Service Message模板作理由。
- 回復：保留各環境原設定，錯audience硬拒绝，不拿Published設定供Preview。

## 3. LINE Pay Sandbox — A 店授權／Confirm／全額退款通過；部分退款及第二商家待驗

- 角色：授權測試商家管理者／收件信箱擁有者。
- 位置：https://pay.line.me/portal/tw/auth/login → 開發者工具 → 管理連結金鑰。
- 2026-09-28證據：沿用既有官方測試帳號重新登入、完成郵件OTP，取得 Sandbox Channel `2011753464`。依授權將既有Secret存於repo外受限目錄。簽章 `GET /v4/payments` 以全新探測orderId查詢，HTTP 200／`1150 Transaction record not found.`；這是唯讀連線證據，沒有建立交易。**不需要重新申請同一測試帳號。**
- 欄位：Sandbox Channel ID/Secret、merchantReference、credentialVersion、正確店別Connection、API v4、currency TWD、callback origin；Secret只存安全設定。
- 已設定：隔離 server 的店別版本化 Secret、DIRECT／SANDBOX A 店 Connection 與公開 HTTPS callback。A `260928-007` 的舊 attempt 維持 CANCELLED／0121；新 NT$30 attempt 已由本人授權，15:44 Confirm 成功，原顧客頁顯示已付款；15:49 全額退款成功並讀回官方明細。超額31元拒絕、相同 key 重送仍只有一筆30元退款及一次 REFUND operation。
- 待辦：具備部分退款能力的新測試交易、B 店獨立 Sandbox 商家及受控未知結果端到端故障驗證。目前交易快照 partialRefundEnabled=false，不能事後改快照冒充部分退款通過。此通路不能當作正式越好吃線上收款資格，正式 QR 收款商店未操作。
- 完成驗證：B01真Request→LINE授權→Confirm；19位ID、取消/返回、查核、UNKNOWN與退款，核對原店收款。
- 阻擋：完整雙店與部分退款 Sandbox 驗收；A 店 Request／Confirm／全額退款已有真實官方證據，不再列為缺少帳號或授權。
- 回復：停新PAY保留原憑證版本/attempt/UNKNOWN，沒有不明退款再送一次的捷徑。

## 4. 各店正式收款及雙店試點 — BLOCKED

- 角色：越好吃一中店、第二家授權測試店之管理者。
- 位置：原商家 /merchant/payments、各店LINE Pay控制台。
- 欄位：Organization/Stall真實ID、LINE Pay線上資格/正式商家名、憑證版本、退款能力、店名地址電話/取餐點、授權店員、合作授權及cutover。
- 前置：雙店Sandbox及現金流程，沒有平台代收。商家不需交自己的Messaging token。
- 完成驗證：同一會員A/B兩店，同一平台OA，不同正確收款商家；A員工不能核銷B、看B消費。
- 阻擋：雙店真驗與正式收款；本候選只有Sandboxhost，LIVE需額外適配與QA。
- 回復：停個別店新單，處理既有未付/UNKNOWN/未交付，不搬動owner。

## 5. HTTPS／Vault／排程／監控 — 隔離站已啟用；正式未啟用

- 角色：平台維運。
- 位置：受控Staging/Preview Vercel、Supabase Vault/DB與Cron、既有Cloudflare/WAF。
- 欄位：HTTPS Endpoint、database fingerprint、32-byte資料金鑰、OA Vault UUID、callback/state secret、CRON_SECRET、worker origin及原report endpoint一致。
- 已確認：PR365 child `gfoscoqwumwdtvkbfoiv`，Vercel sin1 Preview、固定 HTTPS alias、OA Vault、通知及 Pay 查核排程均已運行；真實 LINE 訊息採公開 media URL。只對精確 alias 開放，raw deployments 仍受 Vercel 登入保護。未寫 Production／DR。
- 公開入口：https://stallorder-line-v2-pr365-20260928.vercel.app 。`85f441a` 的 CI `36402335281`、CodeQL `36402335299` 已通過；已讀回部署身分並完成受影響公開流程。保留真人 fixture 的 paired Preview workflow 明列 SKIP，不能稱為 PASS。歷次部署／SQL 證據見 [執行紀錄](PREVIEW_EXECUTION_20260928.md)；資源身分及到期回復以 `artifacts/line-v2-preview-resources.json` 為準。
- 成本：24 小時期限不延長，US$3 管理預算已於9/28 18:19核准；9/29 06:24 起清理。Vercel 團隊用量不是本 PR 專屬成本，最後讀回有時間延遲。詳 [成本](PREVIEW_RESOURCE_COSTS_20260928.md)。
- 完成驗證：Webhook原bytes/簽章、media合法抓取、private no-store、CDN/APM URL遮罩、pg_net commit wakeup、worker lease重啟與首次Push延遲、Pay每分鐘查核。
- 阻擋：真OA圖片/背景時效/實機/正式。
- 回復：保存Primary健康artifact與映射，不影響DR，遵守Staging→Production與单一writer。

## 6. 裝置與外部验收 — B 店 iPhone 掃碼交付通過；其餘案例待驗

- 已驗證：Chrome 真 LINE 登入、會員同意、官方好友查核、同一會員 A/B 訂單列表；本人於iPhone 16 Pro／LINE 26.15.0完成B002相機掃碼，店員與顧客已取餐、OA卡片實際收到。後端只有一筆QR交付事件。B001先前人工API不改稱鏡頭掃碼；手機Chrome B店登入已由本人確認。
- 待補：iOS系統版本、Android本次LINE驗收、其他通知階段、MINI深連結／Session返回、相機拒權、重掃、弱網等裝置邊界；不能將單次正常交付概括為整組G驗收完成。

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
