# LINE 設定與安全測試清單

2026-09-26：程式基礎候選，尚不能收款。這份清單是後續操作依據，不代表已建立外部設定。

## 待讀回的對照

使用者已回覆「已有，稍後提供設定位置」。提供本機設定檔／密碼管理工具或控制台位置即可，不要在對話貼 secret。取得位置後只回報存在、用途、環境、商家及版本，不能輸出 secret／token。

| 設定 | 性質／作用域 | 所需讀回 |
| --- | --- | --- |
| Organization / Stall ID | 私有伺服器設定，店家 | `越好吃`與候選 slug 的實際資料映射 |
| LINE Provider ID | 公開識別，不是金鑰 | 商家所有權與 MINI/OA 的 Provider 關係 |
| developing/review/published Channel ID | 公開識別，環境分開 | 當前 token 唯一可接受 audience |
| LIFF ID / Endpoint URL | 公開識別／網址 | 控制台實際值及 Endpoint 相對路徑 |
| Pay Sandbox Channel ID | 收款帳號識別 | 確認為該商家線上 Pay Sandbox，不能拿 Messaging Channel 替代 |
| Pay Sandbox Channel Secret | 機密，商家、環境、版本 | Vault／安全檔案引用；不放 NEXT_PUBLIC |
| OA Access Token / Secret | 機密，OA | 保留現有通知 Vault 設定，不能以 MINI ID 替代 |
| MINI 認證／模板 | 官方能力證據 | 未取得前 Service Message 維持關閉 |

已有 runtime env reader 與受保護的登入 exchange；管理設定 UI、實際 Pay 啟用仍未完成。不要僅新增環境變數便嘗試啟用收款。新 `MiniAppBinding` 是 server-only 型別化契約，不能由瀏覽器指定租戶或 deployment。

## 取得設定後的次序

1. 讀回對照表，確認專用測試資料與 HTTPS Endpoint；Preview 不可連正式 Pay／DB／published audience。
2. 完成 Session/challenge、現有訂單持久化與安全回跳，建立隔離 DB migration、跨租戶與故障測試。
3. 完成 MINI SDK 初始化及既有店面／購物車入口，更新精確 CSP。不得通配放寬來源、跳過 CSRF 或迴圈登入。
4. 真實 Sandbox Request → LINE 授權 → Confirm → 既有訂單、KDS／列印／Billing 讀回；加測取消、斷線與退款。
5. LINE iPhone／Android 實機，記錄 OS、LINE 版本與遮罩畫面。
6. 通知、圖文選單預設 dry-run；原 OA Manager／API 管理來源先確認，再形成可審查變更。外部 apply 尚未執行。

任何正式啟用須重走專案 Staging／Production 與 DR gate；本次僅 local，不沿用先前部署授權或歷史 Sandbox 結果。

## 使用者逐步設定與第二批執行環境

請先依 [商家設定指南](MERCHANT_SETUP_GUIDE.zh-TW.md)填寫程式庫外的安全交接檔。`check-line-test-settings.mjs --file <path>` 只顯示欄位存在／格式結果，不發起外部請求；它不是登入或付款驗證。

MINI runtime 由 server-only `LINE_MINIAPP_ENABLED=true` 與 `LINE_MINIAPP_BINDING_JSON` 設定，binding 需符合 `src/server/line-miniapp/configuration.ts`，Endpoint path 固定 `/mini`，deployment 與 runtime 相符。預設停用。不要手動把安全交接 JSON 當成 runtime JSON；Codex 需先查商家映射和 HTTPS host 再轉換。

OAuth challenge migration 是 `20260926000100_mini_app_login_challenge.sql`，新增兩欄，保留既有 OAuth 預設和 RLS。必須 DB migration 先於候選程式；回退舊程式可保留額外欄位。尚無遠端 migration。

## 2026-09-26 自動申請進度

使用者已改為授權自動申請與測試。實際盤點見 [越好吃一中店設定紀錄](PILOT_SETUP_20260926.md)：OA 的權限管理與 Messaging API 入口已可用，但 Messaging API 仍未啟用；Developers 僅見平台的兩個 LINE Login Channel，等待確認商家 Provider 歸屬。已登入越好吃 QR 商店，並經使用者確認成功申請台灣 Online Sandbox；等待依信完成首次登入及讀回金鑰。不得把平台登入 Channel ID 或正式 QR 收款商店 ID 填作 MINI／Pay Sandbox ID，亦不能把 Sandbox 申請成功當成付款串接已驗證。
