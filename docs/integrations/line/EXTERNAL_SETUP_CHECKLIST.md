# LINE v2 外部設定清單

更新：2026-09-27，Asia/Taipei。缺項集中於此。欄位只列名稱，不放Secret/OTP。狀態須分開：程式、自動化、真實OA、Pay Sandbox、實機、認證及正式。

## 1. 攤點通平台 OA 及合法營運資料 — BLOCKED

- 負責角色：平台擁有者／OA管理者。
- 控制台：LINE Official Account Manager https://manager.line.biz/；LINE Developers https://developers.line.biz/console/。
- 已確認：原Chrome可用；已知越好吃商家OA不是平台OA。2026-09-27 Developers Session已登出，未live確認平台OA存在及Provider關聯；不宣稱不存在或已建立。
- 欄位：平台OA顯示名/basic ID/bot userId、Messaging Channel ID、Provider ID、管理人、目前Bot/webhook、方案/配額、OA驗證狀態；平台實際法人/客服/會員條款/隱私/退款政策。
- 前置：確認正確Provider和既有整合；未獲授權不新建OA、不升級方案。
- 完成驗證：bot/info精確destination；好友webhook簽章/重送；A/B店都由同一平台OA送測試訊息。
- 阻擋：真OA、對外條款、平台認證及正式啟用。沒有平台OA仍可完成合成adapter/QR測試。
- 回復：保存原webhook/Bot/選單來源，先停止新Push，不清除待發證據。

## 2. MINI App／LINE Login／各環境設定 — BLOCKED

- 角色：同Provider管理者／認證申請負責人。
- 位置：Developers該Provider各Channel，Developing/Review/Published、LIFF、linked OA、tester設定。
- 已確認：歷史v1記錄不作當前證據；本次未重新登入控制台readback。假LIFF ID僅在受限本機fixture中使用。
- 欄位：Provider ID、每環境Channel/LIFF ID、scope、Taiwan region、Endpoint/callback、linked平台OA、tester、Certified Provider、Verified MINI App各自狀態。
- 前置：平台OA/HTTPS Preview/真實條款。OA認證、Provider認證及MINI認證不可相互替代。
- 完成驗證：真LINE首次/重複登入、不同audience拒絕、深連結、帳號切換、失去Session返回；兩種手機版本記錄。
- 阻擋：真身分/永久連結/實機/正式；普通OA Push不以缺Service Message模板作理由。
- 回復：保留各環境原設定，錯audience硬拒绝，不拿Published設定供Preview。

## 3. LINE Pay Sandbox — 帳號登入 PASS；API驗收 BLOCKED

- 角色：授權測試商家管理者／收件信箱擁有者。
- 位置：https://pay.line.me/portal/tw/auth/login → 開發者工具 → 管理連結金鑰。
- 2026-09-27證據：官方「測試ID發出指引」信已存在，已登入台灣測試商家後台；查詢金鑰開啟電子郵件OTP驗證，尚未取用API key。**不需要重新申請同一測試帳號。**
- 欄位：Sandbox Channel ID/Secret、merchantReference、credentialVersion、正確店別Connection、API v4、currency TWD、callback origin；Secret只存安全設定。
- 前置：完成後台電子郵件驗證、安全寫入server版本化secret；驗明這是Sandbox而非正式越好吃收款商家資格。
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
- 完成驗證：Webhook原bytes/簽章、media合法抓取、private no-store、CDN/APM URL遮罩、pg_net commit wakeup、worker lease重啟與首次Push延遲、Pay每分鐘查核。
- 阻擋：真OA圖片/背景時效/實機/正式。
- 回復：保存Primary健康artifact與映射，不影響DR，遵守Staging→Production與单一writer。

## 6. 裝置與外部验收 — BLOCKED

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
