# LINE 測試串接設定指南

更新：2026-09-26。先完成測試帳號及設定，不切換正式收款。目前 3023 提供介面測試；MINI App、付款候選在獨立分支，尚未完成真實 LINE 登入／Sandbox 付款驗收。

## 先分清楚三種服務

| 服務 | 本次用途 | 控制台 |
| --- | --- | --- |
| LINE 官方帳號／Messaging API | 商家好友、取餐通知 | [官方帳號後台](https://manager.line.biz/)及 LINE Developers |
| LINE MINI App | 顧客在 LINE 中開啟點餐、驗證身分 | [LINE Developers](https://developers.line.biz/console/) |
| LINE Pay Online Sandbox | 線上付款測試 | [LINE Pay Sandbox 說明](https://developers-pay.line.me/sandbox)、台灣 LINE Pay 商店後台 |

這三者的 Channel ID／Secret 用途不同。已開官方帳號或已有收款 QR，不表示已取得 MINI App 與線上金流測試設定。

## 1. 找到正確的 Provider

使用管理商家官方帳號的 LINE 帳號登入 Developers，找到該商家的 Provider 及既有 Messaging API Channel。記錄 Provider ID。若希望 MINI 與 OA 使用同一個 LINE 使用者識別，先確認它們在同一 Provider。不同商家不應為方便而全部放進不屬於它們的平台 Provider。

Channel 建立後不能改移到其他 Provider；不同 Provider 的使用者 ID 也不能直接當成同一人。這一步先確認商家歸屬，再新增。[官方 Provider 設計說明](https://developers.line.biz/en/tips/2026/06/25/provider-design-basics/)

## 2. 找到或建立 MINI App Channel

若已有，直接開啟，避免重複建立。若沒有，在正確 Provider 的 Channels 新增 LINE MINI App；服務地區選台灣，商家名稱、聯絡 Email、服務提供者資訊填真實資料。隱私政策網址需對應此服務；平台開發者與商家不同時要正確說明。平台條款由帳號管理者閱讀並接受。

先使用 developing 測試。台灣要申請「認證 MINI App」審核時，官方要求 Channel 位於 certified provider；沒有該資格不等於不能準備測試，但不能把認證、Service Message 等能力視為已核准。[官方建立與審核說明](https://developers.line.biz/en/docs/line-mini-app/develop/develop-overview/)

## 3. 記錄 developing 的兩個識別碼

在 Channel 基本設定取得 developing Channel ID；在 Web app 設定找到 developing LIFF ID。注意不是 OA Messaging Channel ID，也不是 LINE Pay Channel ID。developing、review、published 各有自己的設定，不可混填。

先記錄兩個 ID；本輪 ID Token 驗證不需要你提供 MINI Channel Secret。需要後續服務訊息時再依官方能力及資格設定。[官方 Channel 設定指南](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/)

## 4. HTTPS 入口與測試者

Endpoint 預定格式：`https://<已驗證的測試主機>/mini`。

此處仍是格式範例，不是已部署網址。不要填入正式站，也不要填 `http://127.0.0.1:3023`；手機的 127.0.0.1 指向手機自身，且 LINE 需要適合實機的 HTTPS 入口。待設定讀回、候選 QA 及測試主機就緒後，由 Codex 提供可實際使用的精確網址；本輪沒有發布 Preview／Production。

在 Channel 的角色管理加入實測 LINE 帳號為 tester，接受邀請後，再從 developing 的 MINI 連結 `https://miniapp.line.me/<developing LIFF ID>` 進入。使用者未接受測試權限時，不能以此判斷系統登入壞掉。[官方測試 Channel／角色說明](https://developers.line.biz/en/docs/line-mini-app/discover/console-guide/#internal-channels)

## 5. 取得 LINE Pay 線上 Sandbox

若已有測試商店，先登入原帳號。若尚未有，從 [官方 Sandbox 頁](https://developers-pay.line.me/sandbox)申請，類型選線上付款 Online。本功能是從點餐網頁進入 LINE Pay 授權。

帳號後台找「開發者工具 → 管理連結金鑰」。按查詢後，依畫面要求輸入密碼及 Email 驗證碼，取得 Channel ID 與 Channel Secret。台灣後台入口可從 [LINE Pay 台灣金流串接 FAQ](https://pay.line.me/portal/tw/customer/faq?categoryId=cashflow)進入；不要直接沿用全球英文文件中的泰國商店登入網址。

本候選 transport 固定呼叫 Sandbox 主機 `https://sandbox-api-pay.line.me`。是否使用測試金流必須由 API 主機、帳號與實際回應一起核對，不能只憑金鑰名稱判定。取得設定後仍須測試 Request、授權、Confirm、取消、重複送出及退款；目前尚未完成這些外部測試。

## 6. 安全填寫本機設定

已準備空白檔案：

`C:\Users\KY\.codex\private\stallorder-line-test\line-test-settings.json`

| JSON 欄位 | 複製內容 |
| --- | --- |
| `miniApp.providerId` | 商家 Provider ID |
| `miniApp.developingChannelId` | MINI developing Channel ID |
| `miniApp.developingLiffId` | MINI developing LIFF ID |
| `linePaySandbox.channelId` | LINE Pay 線上測試設定的 Channel ID |
| `linePaySandbox.channelSecret` | 同一金流設定的 Secret |

全部填在原本的雙引號內，保留 `country: "TW"`、`apiType: "ONLINE"`。不要把 Secret 貼進對話、截圖或 Git；檔案位於程式庫之外，已限制 Windows 讀寫權限。若要使用自己的密碼管理器，可改提供安全設定位置。

這是交接設定檔，應用程式不會因為你填寫就自動開始收款。填好後回覆「已填好設定檔」即可；Codex 會讀取、核對用途並完成後續測試，不輸出 Secret。

可選的本機格式檢查（不連 LINE、不發起交易）：

```powershell
Set-Location 'C:\Users\KY\.codex\worktrees\line-miniapp-pay\Stallorder-Platform'
node scripts/check-line-test-settings.mjs --file 'C:\Users\KY\.codex\private\stallorder-line-test\line-test-settings.json'
```

## 7. 官方帳號與取餐通知

先沿用商家已串接的 OA。若還沒設定，提供該 OA 的 Developers 控制台位置，由系統既有商家設定引導核對 Messaging API、Vault 憑證、Webhook 與測試收件者。Vault 是系統保存憑證的地方，不是要到 LINE 另外申請的金鑰。

MINI 顧客登入、加入官方帳號好友、接收通知與同意行銷是不同狀態。這輪先驗證登入與 Sandbox，不自動變更圖文選單或發送顧客訊息。需要不可解除的商務帳號連結時，會先列出實際對象與影響。

## 8. 完成設定後的驗收順序

1. 設定歸屬與環境核對，確認實際測試商家。
2. MINI 登入、關閉重開、拒絕授權、不同帳號與裝置。
3. 補齊既有訂單／付款台帳與 callback，再執行 Sandbox 支付、取消、逾時查證及退款。
4. 店員／廚房／出單／計費只處理一次，異常付款保留查證狀態。
5. OA 通知與 LINE Android／iPhone 實機驗證。

目前還有付款持久化、私人訂單與顧客身分連結、對帳及通知整合未完成；填好金鑰也不代表這些項目自動完成。正式上線須另外通過既有 Staging／Production QA。
