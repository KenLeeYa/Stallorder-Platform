# 點餐與店員看板：本機驗收版

本次額外需求只在 `codex/local-order-experience-20260907` 實作，基於緊急修正 `13fc72289047ee5eb00d43cf84c71398eef122b5`；沒有上傳、部署、資料庫 migration 或正式環境寫入。正式顧客修改／取餐時間修正另見 [緊急修正紀錄](CUSTOMER_ORDER_HOTFIX_20260907.md)。

## 本機測試入口

- 外帶自取：<http://127.0.0.1:3017/store/aming-01?view=pickup>
- QR：<http://127.0.0.1:3017/q/demo-aming-chicken-qr-2026-rotate-me>
- 店員：<http://127.0.0.1:3017/staff/aming-chicken>
- 登入：<http://127.0.0.1:3017/login>，使用頁面上的「本機測試快速登入」。
- 目錄：`C:\Users\KY\Documents\Codex projects\Stallorder-Platform-local-order-experience-20260907`；啟動：`npm run dev:qa -- --port 3017`。
- 專用本機 Supabase API 55621／資料庫 55622。`127.0.0.1` 僅供這台電腦；平板尺寸以瀏覽器模擬驗證。

## 操作與連動

| 項目 | 本機行為 | 連動 |
| --- | --- | --- |
| 新單音效 | 只有首次收到待確認的新訂單發聲。修改、收款、完成、已知訂單消失後再出現、預約到期不重播新單音。手動開啟時仍有試聽。 | 保留視覺提醒、KDS 新單識別與顧客端可取餐通知；商家音效設定說明同步更新六語系。 |
| 免洗餐具 | 外帶／外送確認資料時，放在取餐安排之後、訂單備註之前。預設不勾選，明示未勾選不提供。內用不顯示。 | 本機版以固定首行 `【免洗餐具：需要】` 寫入既有訂單備註，沿用顧客、店員、KDS、列印的備註傳遞，不新增資料欄位。修改會還原勾選；取消勾選保留自由文字。太長時保留文字並阻止送出，請顧客縮短，絕不截斷。 |
| 三區滿版 | 進入店員頁預設逐筆訂單，平板／桌面填滿可見高度；左清單／中品項／右操作各自捲動。 | 未來預約與已完成訂單在下方，可捲動頁面查看。手機保留單欄，廚房及同桌合併保留既有版型。 |
| 已成立預約遇店休 | 追蹤頁核對已確認／原約定時間及待回覆的新時間。受影響時顯示公告，取餐當天額外跳視窗。 | 依店家時區與特殊營業時間判斷；每 30 秒及回到頁面時重查。未自動取消／修改訂單。恢復營業或刪除公告時提示消失。既有單需由雙方協調，新單仍依店休規則限制時段。 |
| 服務中斷遮罩 | QR／外帶偵測 `MAINTENANCE`、不可用或健康資訊遺失時顯示遮罩，停用送出、保留購物車，提供重新檢查／先瀏覽。 | 與非營業時間及特殊店休分開呈現；恢復後重新建立安全點餐工作階段。正常 Vercel 原子部署不強制製造停機。 |

店休提醒目前是顧客開啟訂單頁時的通知；關閉瀏覽器後不會主動發 LINE、簡訊或 Web Push。沒有向正式顧客發測試訊息。

遮罩依賴頁面可載入。若網域／CDN／Next.js 連 HTML 都無法提供，React 無法顯示遮罩；計畫性停機應另由獨立 CDN 維護頁配合服務狀態切換。本次沒有變更 Cloudflare、DNS 或正式維護狀態。

## iPad 鎖屏提示音

目前音效使用頁面的 Web Audio，程式檢查可播放狀態；背景頁面的更新也可能暫停。因此不能承諾鎖屏後持續發聲。這是程式與平台模型的評估，沒有本次實體 iPad 鎖屏測試證據。

1. 店內常駐看板：保持前景、接電，啟用現有「螢幕喚醒」並確認生效，再開啟新單音效。喚醒權限不等於鎖屏通知，也無法阻止手動鎖屏。
2. 必須鎖屏接收：另行實作伺服器 Web Push。iPadOS 16.4 起，加入主畫面的 Web App 可在使用者點擊後請求通知權限，通知可出現在鎖定畫面；仍受通知設定、專注模式與系統音量影響，不能保證每次響鈴或自訂警報音。[WebKit 官方說明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
3. 上線前實機測試：實際 iPadOS、Safari／主畫面 App、前景／切換 App／自動與手動鎖屏、靜音／專注模式／斷網恢復。高峰時段可用另一台保持喚醒的接單裝置備援。

2026-09-07 當時 Web Push 尚未新增。2026-09-11 已完成本機新單推播、訂閱／撤權、Service Worker 去重及 HTTPS 入口，實體 iPad／Android 顯示與音效仍待驗證；最新狀態見 [實機驗收指南](STAFF_PUSH_MENU_ANNOUNCEMENTS_20260911.md)。

## 驗證

已通過 lint、321 個 TSX 控制項稽核、TypeScript，以及完整 Vitest：525 檔、3,028 項通過；另有既有條件式跳過 9 項。

7 項瀏覽器流程通過。補查 240 字店休公告時，在 320×568 重現視窗底部落至 y=708 的問題；已改為固定標題／按鈕、公告內容捲動，320／390／768／1440 及鍵盤焦點迴圈均通過，並重跑 4 項受影響的顧客流程和 41 項相關單元測試。最終正式編譯成功，暫存區敏感資料掃描 0 項。未改 schema，因此沿用 hotfix 同一專用資料庫的 1,543 項 pgTAP 證據，不重複套用 migration。

```powershell
$env:PLAYWRIGHT_APP_URL = 'http://127.0.0.1:3017'
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER = 'true'
npx playwright test e2e/local-order-experience.spec.ts e2e/qr-edit-local-flow.spec.ts e2e/staff-orders-print-runtime-responsive.spec.ts
```

- `local-order-experience.spec.ts`：實際新單後觀察瀏覽器音效；確認、修改、付款、完成、再次出現不加播。已成立預約後新增本機店休，驗證未來公告、當日視窗、關閉不重複、移除公告及保留訂單。
- `qr-edit-local-flow.spec.ts`：餐具預設、勾選、模擬維護遮罩、恢復後內容保留、送出、原單修改還原及取消勾選保留備註；原 QR 取消與外帶聯絡資料回歸仍執行。
- `staff-orders-print-runtime-responsive.spec.ts`：手機單欄，768、1024、1440 三欄滿版及獨立長清單捲動，下方功能可抵達。
- Vitest：餐具字串往返／長度、特殊營業時間／時區跨日、公開公告店家範圍／未知店家／錯誤遮蔽、服務不可用、音效重複判斷、非中文呈現。

測試僅建立與清除自己的本機訂單、商品、QR，並恢復暫時調整的營業時間。硬體音效／列印輸出不在本機 Chromium 通過的證明範圍內。本文件與本機通過不代表正式部署完成。

## 2026-10-25 店休撤回測試的最小修補

PR389 / `40bfe42d` 的 CI `40196069455` 因撤回店休後公告未在 10 秒內消失而失敗；內建 retry 通過仍由 fail-on-flaky 正確擋下。本輪僅授權既有 owned worktree 診斷、最小修補及本機驗證，未發布。

原始案例在新的隔離本機 Supabase／Next production build 重跑五次（retries 0），得到 4 PASS、1 FAIL，重現相同斷言。失敗 trace 顯示舊快照被放行後，下一個 closure GET 未取得 response；另五次原測試的 protocol 診斷皆通過，其中四次仍觀察到 `Fetch.disable` 與下一個 request/pause 重疊。這支持測試的一次性攔截器生命週期競態，但原 CI 沒有 trace，因此不宣稱已證明其內部唯一根因。

最小候選僅改 `e2e/local-order-experience.spec.ts` 的 response barrier：以布林旗標只延遲第一份真實舊快照，後續請求 `route.continue()`，讓攔截器持續到測試 context 結束。不製造空回應、不加 sleep、不延長 timeout、不增加 retry、不放寬 flaky gate，也不修改產品刷新佇列。

- 修補後壓測先有 5 PASS，第六次碰到既有下單 fixture 的 429，剩餘 4 次未執行；不得記成 10 PASS。沒有清除 rate-limit counter 或停用 guard。
- 反向驗證暫時移除產品 `refreshPending`：修補後的原案例仍在同一 10 秒斷言 FAIL（expected 0 / actual 1），證明仍能抓到漏刷新。產品檔立即還原，SHA-256 `19e0163a134e6a68db6a2ed3e9c184f8abf80963c91707ec1622c519971d01fc`，`src` diff 為空。
- 重建還原後的 production build 101 頁通過；原檔兩項完整 E2E 均 PASS（retries 0）：Staff 新單音效回歸，以及店休四寬度／焦點／保留訂單／撤回公告。最終 trace 可見舊回應 200、closure 1，隨後真實 API 200、closure 0。
- 相關七檔 51 單元測試、TypeScript、scoped lint、diff check、production guardrails（2368 檔／146 migrations）通過。獨立審查零未處理問題；完整遠端 CI、普通 Chrome、Staging／Production 驗收未執行。

專用 lab `dr-staging-closure-20261025` 的 146 migrations 只用於新的合成 DB。Edge 原始 node_modules 掛載遇 bare-import boot error，改用同一隔離 lab 的 `/workspace` 掛載後才啟動；瀏覽器額外測試 IP header 仍使 Edge CORS 被擋，頁面使用真實 API/DB fallback。因此這不是 Edge 瀏覽器成功證據。Service Worker 在這份自動化案例內依原設定 blocked，也不是普通 Chrome/SW 驗收。

測試後獨立讀回本次 QR／商品／店休／feature override／訂單五類 fixture 全為 0。七個 lab 容器均已停止，容器、images、DB／Edge volumes 保留；專用 CLI 與 app/mock process 已結束。既有 LINE `127.0.0.1:56863` 保持運作，未停止 Docker Engine。詳細收據與 trace 在 ignored `artifacts/dr-staging-closure-fix-20261025/verification.md`。本機通過不解除原 CI STOP；secret、發布與受保護驗證仍待明確後續指示。
