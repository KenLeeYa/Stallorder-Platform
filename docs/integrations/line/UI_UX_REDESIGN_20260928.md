# LINE MINI / OA 介面改版候選

2026-09-29 更新：承接使用者實機驗證及八張 UI 參考圖，已將中文 Logo、MINI／OA 新介面及原 3023 的功能整合到 PR #365 隔離 Preview。執行來源為 `b8b468fcd0929f74fb0460e17cb299d16d1751c0`，部署 `dpl_hzn6qoRowvdZf8C496G9RJ11TNVV`。原 3023、Production、DR、Supabase parent 均保留。下方早期候選紀錄為歷史證據，現況以文末公開驗收為準；不代表 LINE 正式啟用。

## 介面決策

使用 UI/UX Pro Max 的觸控／間距指引與 Emil Design Engineering 的互動檢查，沿用既有青綠品牌。沒有增加動畫、字型下載、UI 套件、虛構優惠、店家評分或營業狀態。

| Before | After | Why |
|---|---|---|
| 店員掃碼佔用訂單區的大型面板 | 44px QR 圖示放在取餐碼右側，點擊開啟既有原生 dialog | 保留主要訂單空間；焦點可返回原按鈕，Escape 可關閉 |
| MINI 四個純文字分頁 | 手機底部圖示＋文字導覽、目前頁指示、安全區留白；平板／桌面頂部導覽 | 方便單手操作與辨識位置 |
| 菜單頁與購物車同時需要底部空間 | `/mini/store/*` 導覽留在頂部 | 避免遮住原結帳與購物車功能 |
| 店家、訂單、協助均為大量等級接近的文字 | 品牌列、店家卡片、訂單狀態與金額、可展開的常見問題 | 優先呈現下一步操作，減少資訊密度 |
| 會員交易通知以滑動開關呈現 | 原生單選「接收通知／暫不接收」，保留明確儲存動作 | 提供可讀取、可鍵盤操作的選項，不改動同意邏輯 |
| OA 卡片各資訊字級相近 | 店名／狀態／大取餐號碼／金額／QR／操作分層 | 取餐時能快速辨認；取消或完成不再提供取餐 CTA |
| Rich Menu 的「聯絡客服」其實導到 FAQ | 「使用協助」，四入口與 MINI 一致 | 不暗示不存在的真人客服；保留原圖示品牌 |

## 保留的業務與權限邊界

- 店員仍須 `CHECKOUT_ORDERS` 與平台 pickup capability；相機取得／釋放機制不變。
- 掃描只讀取憑證；预覽不核銷；確認交付仍要求實際發餐勾選、版本與 idempotency key。
- 每次重新打開 dialog 清除舊預覽與交付勾選，避免沿用上次確認畫面。
- 顧客訂單所有權、本人 QR、付款／退款限制、LINE 登入、會員條款及通知 consent 不改動。
- OA 訊息維持同一平台 sender、不可變快照與原 deep link；未重新發送既有通知。
- 不複製參考品牌的吉祥物、文字、假資料或尚未支援的取消規則。

## 驗證與證據

本機隔離資料庫 `stallorder_line_miniapp_20260926`、port 55722，測試 app HTTPS 3024。帳號／店家／訂單全部為合成資料，LINE SDK provider 邊界使用既有合成 fixture，不冒稱真實 OAuth 或手機實機通過。

- 相關 unit：49 PASS（7 files），涵蓋 MINI 路由、入會 hydration、OA snapshot、安全連結與 Rich Menu 邊界。
- TypeScript、針對修改檔的 ESLint、production build：PASS。
- 第一輪 production-mode browser：8 PASS；購物車 Circuit A 因本機缺少 publishable key 失敗，1 項後續未跑。既有開發用 Circuit B 僅在 development 啟用，沒有修改正式路徑來使測試通過。
- 開發模式補驗：訪客購物車明確匯入 PASS；外帶／外送、同瀏覽器會員分流、訪客草稿保留、登出後恢復 PASS。只測 Circuit B，不宣稱本機 Circuit A 通過。
- 開發模式截圖曾在 hydration 前注入 caret 樣式而造成 mismatch；改為 `caret: initial`。保留初次失敗日誌，不以截圖操作當作產品 defect。冷編譯跨預約時間級距的錯誤保留於日誌，暖機後購物車案例通過。
- LINE 真 API：四種新 Flex template 均由 `/v2/bot/message/validate/push` 回覆 200；先驗 sender identity、只使用 preview child Vault 中已核准憑證。零訊息發送、零 OA 設定修改。證據 `artifacts/line-ui-redesign/flex-provider-validation.json`。
- Rich Menu：本機產出 2500 × 1686 PNG（139,100 bytes），四入口區域與 manifest 一致。public 資產仍為 example binding，不能直接上傳啟用。
- 最終 production-mode browser：8 PASS / 0 FAIL（15.9 秒），含 320/390/768/1440、明暗色／200% 文字、當前導覽標示、44px QR 相鄰排列、Escape 焦點返回、相機拒絕備援、實際本機核銷、通知同意讀回、跨顧客／角色權限與登出。日誌 `artifacts/line-ui-browser-final.log`。
- 最後視覺檢查另外改善 200% 文字時的歡迎區與通知選項：內距不隨字級無限增長、頭像與說明可換行、通知選項空間不足時改為上下排列；重建後再次通過上述 8 項。品牌英文避免拆字。
- Circuit B 兩個案例分別通過於 `artifacts/line-ui-cart-development-warm.log` 第一項、`artifacts/line-ui-cart-entry-final.log`；不把前者失敗的第二項計入 PASS。第二項改為等待會員表單 hydration 完成再點登出。
- 服務停止及最終正式站唯讀讀回見 `artifacts/line-ui-redesign/qa-receipt.json`；未通過項目不可算完成。

本機圖文檢視：`artifacts/line-ui-redesign/review.html`，Flex 區塊明示為 HTML 版面示意；MINI 圖片為瀏覽器合成測試截圖。

2026-09-28 22:00 後續調整：依使用者回饋，Rich Menu 與 MINI 品牌列移除英文 QIDAIGO，保留圖示與「攤點通」；Rich Menu PNG 重新產生為 133,131 bytes。此為本機候選的文字／版面修改，公開入口仍為原 85f441a。本次驗證另記於 `artifacts/line-ui-redesign/logo-followup-receipt.json`，不把前一版完整 QA 冒充新版本全套重跑。

中文 Logo 增量驗證：12 項 Rich Menu 測試、TypeScript、ESLint，以及 development 模式會員同意／儲存與 320/390/768/1440 明暗色／200% 文字兩項瀏覽器案例均 PASS（1.2 分鐘）。先前只選版面案例時漏跑建立測試訂單的前置案例，導到不存在的訂單頁；補跑既有前置流程後通過，未改應用路由或放寬斷言。兩次日誌均保留；新版截圖已更新。

## 雲端更新界線

22:00 當時 manifest 的 `authorizedRemainingDeployments=0`；先前 US$3 方案只核准 85f441a 修正版部署，因此當時程式候選留本機，沒有變更公開 alias 或 OA 選單。

後續使用者「部署新版介面，並整合先前本機測試環境供我測試使用」授權本次隔離 Preview 更新及 OA 測試選單。維持 US$3 管理預算及原到期時間；Manager／API 原本均無選單，已保存復原計畫並納入原清理自動化。沒有擴充預算或延長期限。

到期仍為 2026-09-29 06:24 Asia/Taipei 起清理、07:24 最晚完成。本次不合併 PR、不正式啟用 LINE、不進行真收退款。

官方格式查核經 AnySearch：<https://developers.line.biz/en/reference/messaging-api/#validate-message-objects-of-push-message>；官方 OpenAPI <https://github.com/line/line-openapi/blob/main/messaging-api.yml>。API 接受格式不等於 LINE 手機排版及收訊實測。


## 2026-09-28 本機功能整合候選

使用者授權部署新版介面並整合既有本機測試功能。本次以實際提供 3023 的 `Stallorder-Platform-ui-ux-redesign-20260923`（基底 766df1e）的工作樹差異進行三方合併，保留 LINE v2、中文 Logo 與 QR 交付工具列。整合單行結帳、即時總額、醒目找零、原生複選與功能按鈕、商戶響應式工具列及移除標題說明。原 3023 與資料保留，不複製商家資料到雲端。

隔離 child 已套用原始購物車摘要綁定及店員外送選填聯絡資料兩項 migration；公開外送仍須電話與地址。摘要寫入使用 stored routine，只在接單時執行，避免 migration-time DML，DR fencing 規則保持不變。`create-public-order` 已由 v42 更新至 v43，14 個部署檔案讀回一致；僅 index 與 shared contract 兩檔內容有變。原始本機專用 opt-in 測試的跳過不列 PASS，實際 CI DB replay 回歸及店員外送／結帳案例已通過。

目標維持 PR365 Preview；US$3 管理預算與 9/29 06:24 起、07:24 前清理期限不變。Production、DR、parent、原本機資料不在此次更新範圍。

## 2026-09-29 公開部署與驗收

- 單一 MINI 入口：<https://stallorder-line-v2-pr365-20260928.vercel.app/mini>。店員使用同站 `/staff/login?next=%2Fstaff%2Fline-preview-store-b`；A 店為 `/staff/aming-chicken`。顧客 LINE 與店員 Chrome 分開使用，避免共用 session 角色。
- b8b468f 的 CI `36451249419`、安全檢查 `36451249378` 成功。單元 3587 PASS／100 SKIP、瀏覽器 214 PASS／78 SKIP／0 FAIL、額外 production resilience 8 PASS；DB／pgTAP、replay、型別、lint、UI audit、build 通過。SKIP 不列成功。paired Preview 因保留真人 fixture 刻意跳過。
- 第一次部署 `dpl_5pT8qXYsKHThv21SAkp5hfUuyytc` 通過 API，但平板商戶仍顯示舊工具列。源檔上傳 SHA1 與候選一致；raw／公開 hostname 的 CSS 都缺少 responsive rules，獨立 production PostCSS 會產生正確 rules。以相同 SHA／runtime、不沿用 build cache 重建後，CSS 由 `3_uu3x7b2o-c8.css` 變為 `3v2k82dugd_is.css`，公開瀏覽器回歸通過。沒有改應用程式或重做 migration／Edge。兩個精確部署都列入清理 manifest。
- 防止此問題再次只靠 READY 結案，新增 `node scripts/check-workspace-ui-assets.mjs <公開測試網址>/mini`；對舊 immutable CSS 實際 exit 1，對新版實際 exit 0。仍須搭配已存在的 merchant responsive E2E 及公開瀏覽器驗證。
- Chrome 實際操作：MINI 中文 Logo、店家卡片 → 菜單、我的訂單／會員登入界線、FAQ 展開；390px 底部導覽、1440px 頂部導覽。未重新登入真人 LINE 或代替手機驗收。
- B 店外帶現金單 `260929-001`：1 份／$30，實收 $10 阻止送出，按 $200 顯示醒目找零 $170；建立後重新整理仍 PAID，資料庫 cashReceived=200、changeAmount=170。這是隔離測試記帳，沒有真實收款。
- A 店外送單 `260929-001`：電話／地址皆空白，稍後結帳成功；修改餐點由 1 份／$30 至 2 份／$60，重新讀回仍 DELIVERY／UNPAID，廚房任務已同步。兩筆訂單 notification jobs 都為 0，未向顧客新增推播。
- QR 按鈕 44×44，位於取餐碼右側且同列，開啟既有交付視窗，Escape 關閉後焦點返回。1024px 店員三欄、商戶 768／1440px 全部 11 個圖示且沒有「所有功能」、390px 主要功能＋目錄、目錄真實跳轉會員與成長均通過。
- OA @028sijlm 新測試 rich menu `richmenu-b107e7d9ef825a9fdf18f101fd15ba5b` 已設定為 default；LINE API 讀回四個區域與連結一致、圖片 SHA256 `cd5fd2fe1f038833afff0b5fda70936f6d24a78212db879042c782892bf62b49` 一致。手機 LINE 選單及新版 Flex 實際顯示待使用者驗證；不沿用舊版實機截圖當新介面證據。
- 正式站最後讀回仍 `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`／5cc15c6、NORMAL_PRIMARY／PRIMARY／EDGE_PRIMARY；login、staff/login、公開店 200，匿名 health 401。未做正式站登入後下单全流程，不冒稱正式驗收完成。
- 原 3023 PID49312、既有 catalog-ops DB 55722 因使用者人工 QA 需求保留，本次未啟動 3024。01:20 Vercel project 含 Primary 的 Infrastructure $2.03（含 Build CPU $0.46）＋24h Micro 估算 $0.32256，較廣範圍參考 $2.35256；最多一小時延遲，非 PR 專屬帳單或硬上限。

主要證據：`artifacts/line-ui-b8b4-{candidate-qa,public-qa,final-primary-readback}.json`、`line-ui-live-orders-oa-readback.json`、`line-ui-cache-repair-css.json` 與 `line-ui-redesign/live-*.png`。瀏覽器紀錄含第三方訊息通道錯誤；已保存觀察，不將其誤報為零 console error。原 LINE 26.15.0／iPhone 16 Pro 掃碼及 Pay Sandbox 歷史驗收另見既有報告；本次未重作相機、iPad 列印／錢櫃、新付款／退款或正式認證。
