# 店員三欄、鎖屏推播及線上 Menu 公告：本機驗收

本次修改位於 `codex/staff-push-menu-announcements-20260911`，承接 `14a48f7c135ebc547cb796d092f2a88bcd01244c` 的商品供應、改單及快速登入功能。實際工作樹為 `C:/Users/KY/Documents/Codex projects/Stallorder-Platform-order-selection-checkboxes-20260911`。目前為 **LOCAL_QA_READY / PHYSICAL_PUSH_PENDING**，未部署 Staging、DR 或正式環境。

## 手動測試入口

| 用途 | 入口 |
| --- | --- |
| 同 Wi-Fi 裝置首次設定 | http://192.168.1.102:3019/ |
| iPad／Android HTTPS 登入 | https://192.168.1.102:3443/login |
| 電腦本機快速登入 | http://127.0.0.1:3018/login |
| 店員三欄看板 | http://127.0.0.1:3018/staff/aming-chicken |
| 商家公告設定 | http://127.0.0.1:3018/merchant/stalls/22222222-2222-4222-8222-222222222222/settings/announcements |
| 顧客線上 Menu | http://127.0.0.1:3018/store/aming-01?view=menu |

同 Wi-Fi 入口連到本機示範資料。需保持這台電腦、資料庫及推播程序運作；電腦休眠、關機或 IP 改變時，此測試入口不能使用。既有商家、店員、廚房、平台管理者四個快速登入按鈕仍可用。

## iPad／Android 實機步驟

1. 裝置與電腦連同一個 Wi-Fi，開啟首次設定入口，下載 `StallOrder Local QA` 測試 CA 憑證。此入口只提供公開憑證與說明，不提供任何私鑰。
2. iPad：安裝下載的描述檔，再於「一般 → 關於本機 → 憑證信任設定」啟用該測試 CA 的完全信任。Android：於系統安全性設定安裝下載的 CA 憑證，選單名稱依品牌而異。只安裝本次提供的測試憑證。
3. 開啟 HTTPS 登入網址。iPadOS 必須 16.4 以上，使用 Safari「分享 → 加入主畫面」，從主畫面開啟；Android 使用 Chrome。iPad 的主畫面 Web App 才能請求並接收 Web Push，且權限必須由使用者點擊觸發。[WebKit 官方說明](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
4. 按「店員」快速登入，在工具列點鈴鐺「鎖屏通知」→「開啟鎖屏通知」，允許通知。
5. 點「30 秒後測試通知」，立即鎖屏。工作由伺服器保存並處理，無需保持網頁計時器執行。記錄是否顯示、是否響鈴，以及點擊後能否回到正確看板。
6. 再由另一台電腦建立一筆新測試訂單；應收到新單通知。修改、結帳及完成同一筆訂單不應產生新的 Web Push。
7. 回到鈴鐺視窗，核對「等待伺服器發送／推播服務已接收／裝置已回報顯示」。服務商接收不等於裝置已顯示；顯示回報也不能證明有音效。
8. 補測切換 App、手動鎖屏、專注／勿擾、靜音、斷網後恢復、取消通知、登出／重新登入。重新登入後需重新連結該裝置。測試後可在裝置設定移除 `StallOrder Local QA` 描述檔／CA 憑證。

提示音由作業系統的通知、音量、專注模式控制，網站無法保證每次響鈴或指定任意警報音。本機自動化未使用實體 iPad 或 Android，也尚無 APNs／FCM 實際送達收據；以上兩項須由實機補驗。這不影響前景原有的新單音效開關。

測試 CA 有效至 **2026-09-18 23:07（台灣時間）**。CA SHA-256 指紋：`EB:4C:5C:2F:1B:D2:5D:C0:66:02:24:09:AF:E1:2A:34:97:E9:81:CF:E5:74:A6:F0:1B:2B:8A:C2:41:CC:BF:B7`。到期或 IP 改變時須重新簽發與安裝；勿把本機測試 CA 用於正式環境。

## 修正與功能契約

### 三欄看板

原本外層具有固定最小欄寬，左側清單又受到 grid 的 min-content 撐寬：768 CSS px 下左欄 clientWidth 206、scrollWidth 368，卡片寬 358，因而出現左右滑動與截斷。改用可縮放的三欄比例、內層單欄 grid、`min-width: 0` 和完整文字換行，三欄各自上下捲動；手機仍是單欄流程。未變更訂單狀態、付款、製作或列印門檻。

### 新單 Web Push

- 新增 `staff_push_subscriptions` 與 `staff_push_deliveries`，由 orders 的 INSERT trigger 在同一交易入列。涵蓋 Node／RPC 的新建訂單；`OFFLINE_POS` 歷史同步及建立時已是終態的資料不通知。訂單 UPDATE 不入列，因此改單、付款及完成不會被當成新單。
- 每台裝置、攤位及登入 session family 綁定訂閱。發送前重新檢查 session 到期／撤銷、profile sessionVersion、有效角色及 `VIEW_ORDERS`；不同帳號／登入 family 的 endpoint 不可直接接管。關閉通知後不再發送。
- 訂閱內容以 AES-256-GCM 加密保存。僅接受驗證過的 Apple／FCM／Mozilla HTTPS endpoint 與合法 P-256 訂閱金鑰，禁止任意網址。資料表啟用 RLS，anon／authenticated 無直接讀寫權限。
- 背景工作採 `FOR UPDATE SKIP LOCKED`、lease 及唯一鍵防重複，最多四次嘗試；404／410 停用訂閱，暫時性錯誤有界重試，五分鐘到期後不補發舊單。已取消／完成訂單在送出前取消工作。
- 沿用根目錄 Service Worker，不替換離線點餐資料庫或更新安全機制。開啟通知前確認 active worker 已具備推播處理器；需要更新時顯示明確說明。通知 tag／IndexedDB 去重；通知文字不包含顧客姓名、電話或餐點內容。
- 顯示通知成功後，worker 使用單筆工作 HMAC 回報；伺服器只接受有時限的顯示確認，不接受任意狀態更新。點擊通知僅能開啟同站台的店員頁。
- `/api/cron/staff-push` 需要 `CRON_SECRET`。本機獨立 worker 每五秒處理一次；`vercel.json` 的每分鐘排程只是未部署的程式配置，不能作為正式背景服務已啟用的證據。
- 必要環境變數：`WEB_PUSH_ENABLED`、`WEB_PUSH_VAPID_PUBLIC_KEY`、`WEB_PUSH_VAPID_PRIVATE_KEY`、`WEB_PUSH_VAPID_SUBJECT`、`WEB_PUSH_ENCRYPTION_KEY`、`CRON_SECRET`。本次私鑰僅保存在本機證據目錄，不進 Git、不使用正式憑證。未設定或金鑰不匹配時明確顯示未啟用。[web-push 維護者文件](https://github.com/web-push-libs/web-push)

### 店家公告

- 商家在「攤位設定 → 店家公告」設定一則公告，包含開關、標題、純文字內容、選填起迄時間及預覽。時間依攤位時區保存，結束必須晚於開始。
- 只有 `MANAGE_STALL` 可保存；CSRF、長度驗證及 revision 防止其他分頁覆寫。標題上限 80 字、內容 2,000 字。內容不執行 HTML 或 script。
- 有效公告在顧客進入線上 Menu 時顯示遮罩；同分頁關閉後不重複跳出，可按「查看店家公告」重看。商家更新產生新 revision，下次進入／重新整理會顯示新內容；不主動中斷顧客已開啟的頁面。
- 特殊店休提醒優先，顧客關閉後才顯示活動公告，同時間不堆疊兩個遮罩。公告到期自動關閉。僅影響線上 Menu 顯示，不開啟被店休、庫存、時間或維護規則關閉的點餐能力。
- 消費者公告按鈕已有六語系文字，商家自行輸入的內容照原文顯示；本次新管理表單及推播說明以繁體中文呈現。

## 已完成的自動化驗證

| 範圍 | 結果與證據 |
| --- | --- |
| 單元、既有相依回歸 | 18 檔、106 項通過，含推播加密、工作重試／撤權、SW 去重／點擊／顯示失敗、公告時間、PWA 更新保護、Menu／預約及店員看板 |
| TypeScript／lint／build | `tsc --noEmit`、本次變更相關 ESLint、Next build 通過；npm audit 0 vulnerabilities |
| Chromium E2E | 五個完整案例通過：權限與新單唯一入列、響應式看板、公告 lifecycle、管理預覽／儲存、店休優先及權限負向 |
| 響應式跨引擎 | Chromium／WebKit 各測 320／390／768／820／1024／1440／1920、一般／長者，共 28 組版面；三欄及頁面沒有非預期水平 overflow |
| DB 併發 | 兩個真實 cron 請求同時處理四筆停用訂閱工作，每筆只被領取一次，全部 CANCELLED，未向外部 provider 發送 |
| HTTPS 實際入口 | 嚴格驗證 CA chain／IP SAN、錯誤 Host／Origin 403、公開 CA 下載、私鑰路徑 404；LAN HTTPS 四角色按鈕及店員登入可用；active SW secure context／根 scope／能力握手通過 |
| 英文及密鑰檢查 | 實際公告元件搭配應用程式 CSS，390px 英文關閉／重看通過；未完整翻譯的示範 Menu 仍依原規則回到中文。三項本次私密設定未出現在 44 個變更檔案或 396 個 client build 檔案，無私鑰區塊 |
| 實體裝置 | **待使用者 iPad／Android 實測**。Headless WebKit 未提供 PushManager，只驗證不支援時的禁用及說明，不能冒充 iPad 推播證據 |

本機 E2E 曾抓到並修正兩項實際缺陷：PostgreSQL advisory lock 的 void 回傳造成 Prisma 訂閱 500（改為明確 text cast）；React StrictMode 舊 dialog close 事件關掉新開的視窗（只接受已關閉 dialog 的事件）。HTTPS 初次檢查遇到 Next 冷編譯及 SSR 尚未 hydration 的測試時序，預熱並等待事件已綁定後完成真實登入／按鈕驗證，未放寬業務成功條件。

證據目錄：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/staff-push-announcements-20260911`。包含 before/after 版面量測、browser QA 收據、截圖、`worker-database.json`、`https-device-entry.json`、`build.log`。測試商品、訂單及一則有效的「本機範例活動公告」保留；所有自動化假訂閱已停用。店員打卡未啟用時背景 attendance API 的既有 409 不屬於推播失敗，未阻斷本次流程。

## 本機資料與服務生命週期

本次 additive migration 為 `20260911190000_staff_push_menu_announcements.sql`，已備份本機 DB 後透過本機 psql transaction 套用並產生 Prisma client；未操作任何遠端 migration。備份 `before-push-announcement.dump` 保存在證據目錄，含本機測試資料，勿公開。未以 Supabase CLI 重放整份歷史 migrations；後續遠端發布須先完成相同版本的正常 migration 與 Staging 驗證。

使用者要求實機測試，故依手動 QA 例外保留：

- 3018：此分支 Next 開發服務；55722：`supabase_db_stallorder-catalog-ops-20260907`，其餘七個 Supabase 容器仍停止。
- 192.168.1.102:3019／3443：說明與 HTTPS 代理；僅接收同一 LAN 網段並驗證 Host／Origin，沒有公開 tunnel、DNS 或正式入口變更。
- 無監聽 port 的 `local-push-worker.mjs`，負責顧客瀏覽器關閉後繼續處理推播工作。
- 兩組供應鏈及 `kuanguard-db-1` 維持原狀，不屬於本次啟停範圍。

證據目錄的 `start-app.mjs`、`start-device-qa.mjs` 讀取本機設定並啟動以上程序。以 `Start-Process -WindowStyle Hidden` 啟動，不把環境密鑰寫到命令列。`app-process.json`、`device-process.json`、`https-process.json` 保存當次 PID／工作樹；每次停止前需重新核對 port owner、命令列及父子關係，不能沿用歷史 PID。執行會建立假訂閱的 E2E 前先暫停背景 worker，避免測試 fixture 被送到外部 provider；測完確認假訂閱全數停用後才恢復 worker。

測試結束時停止這兩棵 launcher 的精確子程序，確認 3018／3019／3443 關閉，再於沒有其他使用者時 `docker stop --timeout 30 supabase_db_stallorder-catalog-ops-20260907`。只停止、不刪除資料。再次需要時核對 project label、啟動該 DB 並等待 healthy，再啟動兩支 launcher；憑證到期前須先更新。保留本機 Web Push 時以 `LOCAL_QA_ENABLE_WEB_PUSH=true` 作為 QA launcher 的 PWA 例外，其他本機測試仍預設停用開發 Service Worker。
