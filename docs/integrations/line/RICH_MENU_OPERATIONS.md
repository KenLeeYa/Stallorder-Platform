# 平台 Rich Menu 操作

2026-09-27。本次只產生本機版面與工具，未連接 OA、未建立／切換 provider 選單、未修改歡迎訊息。

## 資產及入口

`public/line-platform/rich-menu.svg` 為可編輯向量版面，內嵌原有 `public/icons/stallorder-512.png` 品牌圖示；PNG 由 sharp 本機轉換。四格使用 QIDAIGO／攤點通文字、原有青綠色及自製 SVG 線條圖示，無外部圖片或其他品牌吉祥物。

`rich-menu.json` 是 LINE 操作區定義，採官方操作教學使用的 2500 × 1686 尺寸、PNG，工具另外限制低於 1,000,000 bytes。已產出圖片約 140 KB。每格 1250 × 760，頂部 166px 為品牌列；URI action 帶讀屏可用 label。圖片文字不能取代訊息中的可讀文字連結。

| 入口 | 本站既有 route | MINI permanent link |
|---|---|---|
| 立即點餐 | `/mini` | `https://miniapp.line.me/{liffId}` |
| 我的訂單 | `/mini/orders` | `https://miniapp.line.me/{liffId}/orders` |
| 會員中心 | `/mini/member` | `https://miniapp.line.me/{liffId}/member` |
| 聯絡客服 | `/mini/help` | `https://miniapp.line.me/{liffId}/help` |

本次提交的 JSON 使用 `--example` 合成 ID，僅供版面／程式驗證，不能宣稱這些示例 URL 已連到正式 LINE channel。部署前須以正確環境的真實 `LINE_PLATFORM_BINDING_JSON` 重新 dry-run，再由裝置驗證永久連結。產生器會確認四個本地 route 存在，完整 manifest 必須與固定四入口完全一致，不能注入任意 URL、店家 sender 或顧客 token。

## 官方查核

本次經 AnySearch 讀取 LINE 官方文件：

- [Rich menus overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)：圖片為 JPEG／PNG，API 與 OA Manager 各自管理；API default 優先於 Manager default，per-user API menu 又優先於 default。桌面版 LINE 不顯示相同的 Rich Menu。
- [Use rich menus](https://developers.line.biz/en/docs/messaging-api/using-rich-menus/)：官方 2500 × 1686 範例、建立 → 上傳圖片 → 設定 default 流程。
- [Messaging API image requirements](https://developers.line.biz/en/reference/messaging-api/#upload-rich-menu-image-requirements)、[Bot info](https://developers.line.biz/en/reference/messaging-api/#get-bot-info)：provider 正式啟用前再次確認當日限制；工具採保守 1 MB 上限，沒有以未讀全的參考頁宣稱所有可用尺寸。

API 404／空清單只能證明「本 API 沒有讀到預設值」。它不能證明 Manager 無選單、無排程、無第三方 Bot 或 per-user 覆蓋。

## 本機產生（零 HTTP／零 DB）

```powershell
node scripts/line-platform-rich-menu.mjs --example
npm test -- scripts/line-platform-rich-menu.test.mjs
```

預設 `dry-run`，輸出三個 public 資產，以及 `artifacts/line-platform-rich-menu/dry-run.json` 的 deep-link 對照、歡迎訊息草稿、阻擋事項與 hash。`publishable:false`、`providerVerified:false`，不能把它直接用於 apply。

真實設定以既有 server `LINE_PLATFORM_BINDING_JSON`／`LINE_PLATFORM_ENVIRONMENT` 注入程序；不從 CLI 接受 access token，不自動讀任意 `.env`，不輸出 binding 或 secret。`VERCEL_ENV` 必須對應 preview／production；local 使用 `APP_ENV=local`。憑證仍保存在既有 vault，沿 `oaAccessTokenReference` 讀取，永不選商家 OA。

## 管理來源確認及 read-only inspect

只有具資料庫／安全設定操作權限的平台管理員可執行。工具另查 `profiles.is_active` 及 `platform_role=PLATFORM_ADMIN`，核對唯一 `sender_scope=PLATFORM_OA` integration 的 environment、provider、channel、destination 及 vault reference，再用 `GET /v2/bot/info` 比對精確 destination userId。該 CLI 不是公開授權 API；不得把 DB 憑證或腳本執行權提供給商家。

先由管理員在正確 OA Manager／第三方管理介面實際確認管理來源與復原說明，於安全位置保存 policy JSON（以下為形狀，UUID／時間／原 default 需填真實值）：

```json
{
  "version": 1,
  "operatorProfileId": "33333333-3333-4333-8333-333333333333",
  "manageScope": "API",
  "apiPolicy": "EXCLUSIVE_PLATFORM",
  "managerMenuState": "NONE_CONFIRMED",
  "managerCheckedAt": "2026-09-27T06:00:00Z",
  "manualRecoveryReference": "已審核的操作單／Manager 人工復原紀錄位置",
  "expectedDefaultRichMenuId": null
}
```

`MANAGER`、`UNKNOWN`、共享 API 管理、Manager 已有選單／排程、未確認或超過 24 小時的檢查，一律停止。人工聲明必須有實際查核依據；JSON 值不是取得管理權限的方式。若 Manager 管理既有選單，使用 Manager 保留的原圖／操作區／排程與人工變更流程，不由此工具覆蓋。

在提供既有環境設定後：

```powershell
node scripts/line-platform-rich-menu.mjs dry-run --output artifacts/rich-menu-review
node scripts/line-platform-rich-menu.mjs inspect --policy C:/secure/rich-menu-policy.json --output C:/secure/rich-menu-plan-unique
```

inspect 只做 DB／LINE GET；保存原 default ID、API 可取得的完整選單 JSON 與原圖 bytes/hash，以及 `plan.json`。新 output 不能重用已有 plan／backup。無 API default 會記錄 null，但仍要求獨立 Manager 確認，沒有偽造完整 Manager 備份。備份含舊 action URL，保存在非 public、非版控安全目錄。

## 經授權後 apply／restore

本次未執行以下命令。工具旗標不替代使用者授權／發布 QA。

```powershell
node scripts/line-platform-rich-menu.mjs apply --policy C:/secure/rich-menu-policy.json --plan C:/secure/rich-menu-plan-unique/plan.json --plan-hash <審核過的完整SHA256> --overwrite-existing
node scripts/line-platform-rich-menu.mjs restore --policy C:/secure/rich-menu-policy.json --plan C:/secure/rich-menu-plan-unique/plan.json --plan-hash <同一份SHA256> --overwrite-existing
```

apply 綁定 tool、image、manifest、binding、policy 與 original default，計畫有效一小時。既有 default 必須有原配置備份及 `--overwrite-existing`；寫入前後均讀回 sender／default，偵測 drift 就停止。先寫 durable receipt，再建立與上傳，最後切換 default。外部 timeout 不自動重試建立，不自動刪除選單；receipt 記錄 `UNKNOWN_REQUIRES_READBACK`，由管理員先讀回狀態。

restore 只可在目前 default 等於本次 receipt 的新 default 時復原，原圖與 JSON 檔案及 provider 原 menu 均須 hash 相符；原 default 為 null 時僅解除本次 API default。它不刪除選單、不改 per-user links、不改歡迎訊息。復原可超過 apply 的一小時，但仍需 24 小時內的 Manager 檢查；只能更新 policy 的檢查時間，管理範圍／operator／回復依據仍須與原計畫相同。工具本身已變更、舊選單已刪除或 Manager 狀态已改變時，停止並沿人工復原紀錄處理。

LINE 切換 API default 非原子 compare-and-swap；最後一次 readback 與 POST 間仍有競態，必須維持單一受權 remote writer。過程未改動 webhook、歡迎訊息、帳號方案或任何商家 OA。

## 歡迎訊息與桌面備援

草稿：「歡迎使用攤點通。您可以選擇合作店家點餐，並在這裡接收訂單與取餐通知。點選『立即點餐』開始；既有訂單請至『我的訂單』查看。」

人工審閱時附上同四個永久連結，讓 LINE 桌面可用訊息按鈕／文字進入。不能把未知好友／通知授權狀態說成已註冊完成。此工具僅交付草稿，不發送訊息，也不覆寫既有 greeting。

## 本次證據與界線

Node test runner 12/12 通過：惡意 URL／環境、未知管理來源、錯 sender、offline dry-run、精確 manifest、plan/hash 改動、備份／apply／restore、timeout 與 default drift，並拒絕將復原資料寫入 public；provider 是測試替身。實際 CLI `--example` dry-run 已產生 2500 × 1686 PNG（140,328 bytes），回報 providerCalls=0，圖片已開啟檢視中文字與四格。

實際 OA sender／Manager 狀態、provider upload、iOS／Android 點擊、桌面備援及正式連結均未驗證，不列為 PASS。Rich Menu 本身不提供動態字級，200%／讀屏須以 MINI 目的頁及訊息 label 另驗證。
