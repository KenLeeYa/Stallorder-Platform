# LINE MINI / OA 介面改版候選

2026-09-28，承接使用者實機驗證及八張 UI 參考圖。僅在 LINE 隔離 worktree 實作；原 3023、Production、DR、Supabase parent 均保留。PR #365 公開 Preview 仍是 85f441a，本文件不代表已部署。

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

目前 manifest 的 `authorizedRemainingDeployments=0`；先前 US$3 方案只核准最後一次 85f441a 修正版部署。本次程式候選先留本機，未 push 觸發新部署、未變更公開 alias、未套用 OA default Rich Menu。

若要公開實測新版，需補充核准一次 PR365 Preview 更新與 OA 測試選單套用的具體範圍，維持 US$3 管理預算及原到期時間，先重新核對用量。OA 套用前須確認 Manager／API 的管理來源及現有選單，保存可讀回的復原資料；任何新 OA 設定須加入到期清理收據。若用量不足，不自動擴充預算或延長期限。

到期仍為 2026-09-29 06:24 Asia/Taipei 起清理、07:24 最晚完成。本次不合併 PR、不正式啟用 LINE、不進行真收退款。

官方格式查核經 AnySearch：<https://developers.line.biz/en/reference/messaging-api/#validate-message-objects-of-push-message>；官方 OpenAPI <https://github.com/line/line-openapi/blob/main/messaging-api.yml>。API 接受格式不等於 LINE 手機排版及收訊實測。


## 2026-09-28 本機功能整合候選

使用者授權部署新版介面並整合既有本機測試功能。本次以實際提供 3023 的 `Stallorder-Platform-ui-ux-redesign-20260923`（基底 766df1e）的工作樹差異進行三方合併，保留 LINE v2、中文 Logo 與 QR 交付工具列。整合單行結帳、即時總額、醒目找零、原生複選與功能按鈕、商戶響應式工具列及移除標題說明。原 3023 與資料保留，不複製商家資料到雲端。

資料庫僅候選隔離環境新增原始購物車摘要綁定及店員外送選填聯絡資料兩項 migration；公開外送仍須電話與地址。摘要寫入抽成明確 stored routine，只在接單時執行，避免 migration-time DML，DR fencing 規則保持不變。部署前必須通過新 HEAD 的 CI、DB 與實際流程；目前尚未發布。原始本機專用 replay 測試保留獨立 opt-in，不將跳過視為通過。結帳與外送瀏覽器案例另可在 loopback CI fixtures 執行。

目標維持 PR365 Preview；US$3 管理預算與 9/29 06:24 起、07:24 前清理期限不變。Production、DR、parent、原本機資料不在此次更新範圍。
