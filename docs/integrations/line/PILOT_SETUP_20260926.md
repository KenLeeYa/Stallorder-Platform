# 越好吃一中店 LINE 測試串接實際盤點

> v2 已取代此文件的「各商家 OA 發通知」設計；以下保留為歷史盤點。平台 OA／會員採 [現行設定手冊](SETUP_RUNBOOK.md)，各店 LINE Pay 仍獨立收款。不可依此舊稿啟用新的商家通知通道。

2026-09-26，使用者授權自動申請所需 ID 並以此商家測試。此紀錄不代表申請或完整串接已完成。

## 已由實際頁面確認

| 項目 | 已確認值／狀態 |
| --- | --- |
| 正式系統商家 | 越好吃一中店 |
| Organization | `7407d09e-fd93-4c47-8dc1-7b2b131657d4` |
| Stall | `55f37d10-3e35-4c44-9f6e-005890f740b5` |
| 商家管理入口 | `/merchant/a-hong-he-fen` |
| 官方帳號 | 越好吃-一中攤車，`@653jltol` |
| 目前 OA 權限 | 使用者調整後，設定側欄已可見「權限管理」與「Messaging API」；Messaging API 頁面狀態仍為「未使用」 |
| 可見 Developers Provider | `StallOrder`，ID `2005461563` |
| 現有 Channels | `2011580550`：StallOrder 正式登入／LINE Login／Published；`2011201000`：StallOrder／LINE Login／Developing |
| MINI App 申請頁 | 台灣地區可選；尚未建立。存在協議、台灣服務地區及代表公司授權聲明 |
| LINE Pay 商店 | 已登入並選取 `WS.2150.QR`／越好吃，主要管理者；綁定 OA `@653jltol`。這是既有正式 QR 收款商店，不能視為 Online Sandbox 金鑰已取得 |
| LINE Pay Sandbox | 使用者明確核准後，於官方 Developers Sandbox 表單提交 Taiwan／Online API／TWD；頁面回覆「Your sandbox account is now ready. Check your email inbox.」。等候使用者依信完成首次登入，尚未取得 Channel ID／Secret |

證據由使用者原 Chrome 的正式商家儀表板、LINE Developers Channel 卡片、OA Manager 帳號一覽及設定頁讀回。未修改既有正式登入 Channel、商家設定、OA 回應、Webhook 或圖文選單。

## 必要協助與接續順序

1. OA 管理入口已恢復可用。不能因目前只看得到平台 Provider，就把商家的 MINI 建在錯誤 Provider 下。
2. OA 尚未啟用 Messaging API。已請使用者選擇「建立越好吃 Provider」或「綁定既有 StallOrder Provider」；尚未收到此項選擇，不擅自進行不可移轉的綁定。
3. 準備「越好吃一中店（測試）」申請資料及真實服務提供者資訊；以台灣 developing Channel 測試。到建立時依瀏覽器工具規則處理明確協議與憑證權限確認，不將概括自動化要求當成協議已接受。
4. Sandbox 申請已成功，使用者依申請信完成首次登入；涉及建立／變更密碼的步驟交由本人操作。之後讀回測試商店身分、Online 類型與測試金鑰，不能使用 QR 正式商店的金鑰代替。
5. 確認 ID 後才寫入安全設定檔；不得抄入未核對的示範 ID，不記錄 Secret／OTP。
6. 取得 Channel 後仍需完成安全 HTTPS 測試入口、真實 LINE 登入與付款持久化／對帳連動，再執行 Sandbox 交易案例。不得以 ID 申請成功代替流程完成。

此次已提交並收到 Sandbox 帳號建立成功的官方確認；未建立 Provider／MINI Channel，未啟用 OA Messaging API、未發送 OA 訊息或啟動交易。3023 是既有 UI 手動測試，仍使用本機示範資料；正式商家資料不會因盤點而複製至本機。

## 本次外部操作證據與界線

- 申請入口：`https://developers-pay.line.me/sandbox`。
- 申請類型：Taiwan (TW)、Online API、Taiwan New Dollar (TWD)。使用現有 Developers 聯絡信箱；信箱與任何後續密鑰不寫入此紀錄。
- 使用者於表單提交前明確回覆「同意提交此 Sandbox 申請」。
- 成功截圖：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/line-pilot-setup-20260926/sandbox-account-ready.png`。
- 尚未完成：Sandbox 登入、金鑰取得、真實 API Request／Confirm、MINI 登入、訂單／付款持久化及實機流程。帳號建立成功不等於串接 QA 通過。
- LINE 官方說明：`https://developers.line.biz/en/docs/messaging-api/getting-started/` 明定 OA Provider 綁定後不能變更或解除；`https://developers-pay.line.me/sandbox` 說明 Online／Offline Sandbox 及每個信箱一個 Sandbox 的限制。
