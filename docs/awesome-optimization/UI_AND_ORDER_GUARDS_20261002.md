# 2026-10-02 介面與公開接單邊界更新

本輪只在 responsive-cross-device 本機候選實作；正式站、DR、LINE 控制台與已到期 Preview 沒有寫入。使用者選擇 LINE 本機介面與模擬流程，不是實際 LINE 登入／OA 送達測試。

## 使用入口

- 商戶登入：http://127.0.0.1:3026/login
- 共用商品：http://127.0.0.1:3026/merchant/catalog?organizationId=11111111-1111-4111-8111-111111111111
- 庫存與配方：http://127.0.0.1:3026/merchant/supply?organizationId=11111111-1111-4111-8111-111111111111
- 店員：http://127.0.0.1:3026/staff/aming-chicken
- LINE MINI／OA 介面模擬：http://127.0.0.1:3026/local-qa/line

商戶測試帳號 owner@stallorder.test，店員 staff@stallorder.test；密碼 StallOrderDemo!2026。多組織帳號依權限選取「StallOrder 示範商戶」，不要把舊 3023 與新 3026 的同主機 cookie 視為不同身分。

## 本次變更

| 範圍 | 原狀況 | 新行為 |
| --- | --- | --- |
| 共用商品 | 標題被工具擠到換行、手機控制項不齊 | 標題單行；工具群靠右並可換行；手機搜尋一整列、狀態與排序並列 |
| 列內編輯 | local state 換成完整管理，關閉後留在該畫面 | 保留原清單／搜尋／分頁，僅開商品對話框；完整管理仍由明確入口開啟 |
| 通知 | 頁面文字入口重複且無返回 | 商戶與店員功能列鈴鐺＋私人未讀數，通知頁有返回；同組織／店鋪 scope 重驗權限 |
| 商品配方毛利、配方項目 | 全品項直列 | 各自搜尋與每頁 6 筆；未建配方總數保留 |
| 庫存批次、原料、供應商、庫位、採購單、異動 | 大量已載入資料全部直列 | 各先 6 筆，可獨立更多／收合；低庫存及效期提醒按完整資料計算 |
| LINE | 本機真 MINI 缺 provider runtime | 獨立、本機限定的示意店家／訂單／會員／FAQ／OA 卡片與圖文選單，記憶體流程、不送訊息、不付款 |
| 公開修改訂單 | 增品／增量未走新單的接單 gate | 新負擔重驗 QR／店況／即時營業日／通路／桌位／schedule，預購重驗原 future slot及供應期限；套餐替換也重驗 |

通知中心是既有事實的私人收件匣：組織範圍主要為帳務通知；店員為自己的推播訂單紀錄；申請者為申請通知。它不等於所有訂單事件，也不新增 LINE、Push 或 Email 發送排程。標記已讀只影響目前帳號。通知偏好不等於取消外部推播訂閱。

## 類似漏洞盤點與證據邊界

- 公開價格／客製選項：原 canonical 及 edit 由後端產品／選項計價，未依客戶端金額授權；本輪沒有放寬。
- 數字庫存：既有 deferred constraint trigger 在 SKU 鎖下處理建單／修改／取消；本輪未更動，最後庫存與確認／付款競態仍不冒充完整實測。
- 取餐／付款：既有 LINE Pay owner、CSRF、金額版本及已付款 READY 交付 gate 保留；本輪未做實際 Pay／實機交付。
- 跨組織追蹤修改：token＋device 驗證後由原訂單組織／店鋪選取可信產品，新 gate同樣核對 QR org/stall；不新增 auth bypass。
- 再次點餐：仍重新建 session／訂單，沒有繞過新單接單條件。
- 既有套餐快照無 durable choice ID：只有能唯一辨識且定義時間戳未晚於原快照才保留舊份數；歧義、同名重建／改掛不能冒充原配置。保守拒絕時請店員協助，不新增 schema 猜測身份。

本輪並非全系統安全認證。來源盤點與 mock／本機 API／SQL／浏览器證據分開記錄；詳細條件見 CUSTOMER_ORDER_EDIT_FULFILLMENT_GUARDS_20261002.md。未有必要 runtime 證據的分支維持 NOT_RUN。

## 其他手機長清單優先序

已修改 Supply Lite 高量清單，並補齊損益4區、排班薪資5區、出攤行程與發票文件共11區：手機先6筆、每次增加6／收合，768px以上保留完整清單；完整摘要、異常、方案額度與原操作ID維持。資料／scope切換包括A→B→A重置。來源範圍與既有資料上限見 docs/architecture/mobile-operational-lists.md；大量fixture與真實頁面證據分開記錄，不宣稱所有系統清單已逐頁全面改版。

## 驗證收據

原始失敗、獨立審查、來源快照及測試資料在 .superpowers/sdd/2026-10-02-ui-followup/，商品／Supply 元件 handoff 在 .superpowers/sdd/2026-10-01-awesome-optimization/catalog-ui-followup/ 及 supply-mobile-list-fix/。最後建置與真實入口結果另於完成時補入，不能以中間建置 h1f9wzXGCZsxGmtMMw7So 推定最後版本。

## 核心候選本機驗證（2026-10-02，未發布）

- 核心 artifact `Ex1TXcQ7hIRc5MIjwNuxO`，HEAD `87230e266281472a71fd764d616be1adf788c635` 加未提交修改，source SHA256 `0d7370706c771f5473b0c3fa6cf0fa5a4f446935392f20d4d0c8665b1a3f7102`；完整 Next／TypeScript 建置通過。此為核心中間版本，其他長清單整合後需另封存最後 artifact。
- 真實本機瀏覽器：共用商品清單與完整管理 320／390／768／1024／1440 無頁面水平溢出，完整管理標題 36px 單行；搜尋 QA 第3頁編輯關閉／儲存200後保留清單位置；組織與店員通知頁返回原 scope；Supply 320／390／768 無頁面水平溢出。
- LINE 模擬：建立／準備／完成／取餐四階段及四張 OA 示意卡、關閉通知後不建立示意卡通過；匿名入口需登入。不是實際 LINE 登入、OA 發送、支付或實機掃碼。
- 人為瀏覽器攔截儲存503：錯誤可見、對話框保留、關閉回原搜尋第3頁；這是合成錯誤測試，不是供應商故障實測。
- 公開修改真實 API／DB 9案例：DEFAULT與DELIVERY閉店增量拒絕且訂單與事件不變、閉店減量成功、外送停用增量拒絕；有效預購增量成功、預購停用增量拒絕且不變、減量成功。臨時QR／session／訂單清除，原店況／設定／updatedAt還原。
- 兩連線SQL桌位 FOR SHARE 阻擋並行停用（55P03）且原桌位不變；這是鎖定原語驗證，不宣稱整個修改／付款競態通過。
- 私人未讀與返回、LINE本機gate、商戶導覽聚焦4檔11測試通過；商品與Supply實際 mounted fixtures 另見各 owner 收據。未做全系統安全认证。
- Production僅唯讀：`dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ` READY／`5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`；登入與店員登入200，health401保護。未發布、未驗證正式站完整訂單流程。

以上收據位於 `.superpowers/sdd/2026-10-02-ui-followup/`：`ui-browser-results.json`、`ui-extra-results.json`、`catalog-error-results.json`、`public-edit-http-results.json`、`table-two-connection-results.json`。保存中間404失敗，不以重試覆蓋已知缺口。


已知本機資料邊界：此 lab 保留先前各批測試資料；唯讀檢查此組織有14個非主測試攤位缺 ordering settings，主測試攤位設定存在。啟動紀錄另有 missing-settings／非指定 route 錯誤，本輪未把未知預取來源誤列為指定看板通過。本輪手測指定 `aming-chicken`，實際 staff-primary-workspace 與訂單三欄已載入、通知返回通過；沒有把所有 fixture 攤位視為可營運店家，也未為清理這些歷史資料做 reset／補種或權限放寬。


## 最後整合版與保留環境

- 接受的完整 Next／TypeScript 建置：`2Xirm6xoT0aep5OWw_1Kj`，HEAD `87230e266281472a71fd764d616be1adf788c635` 加本輪未提交來源；source SHA256 `71ba843186738a8fd11450b8297611b8224497d8c46506d98aebf88b22fd9008`，artifact SHA256 `3df83c479dceb7d78158ffabf26bccd049cc7a9ffaec1f1fc4d5ece69b9d07c0`。原始來源 provenance 保存在 accepted-build-provenance.json。
- 最後實際瀏覽器：四營運頁320／390／768／1440共16寬度案例通過；實際商品毛利9筆手機6→9→6通過。排程／發票現有資料為空態，密集尾筆、精確操作ID與完整摘要證據另來自實際元件／記憶體fixture，未假裝大量DB測試。
- 商品清單／完整管理五寬度、搜尋第3頁儲存與關閉返回、組織／店員通知返回、指定店員三欄workspace、Supply三寬度、LINE四階段／OA卡片／通知退出、匿名登入gate皆在最後artifact重測通過。儲存503合成錯誤在bi9中間artifact通過，其相關runtime來源與最後版本相同。
- 四區來源19聚焦測試及獨立審查通過。發票320溢出的真實RED與Tailwind mounted RED均保留；修正只讓provider卡片縮寬、狀態代碼完整換行，不截斷、不藏資料。round2審查P1/P2均0。
- bi9→最後版只有invoice CSS元件與其測試檔的src digest改變；public-order-edit及staff-order-create最終digest仍分別DD699B…／C4A3E7…，與9真實API案例的被測來源一致。本轮未重跑会暂时关闭手测店铺的API写入；完整修改／支付／最后库存竞争未测。
- 最後Production唯讀：同一Primary project／deployment／commit，login200、stafflogin200、health401保護。沒有遠端發布或設定變更；正式登入後訂單操作不是本輪驗證範圍。

本機已保留 `http://127.0.0.1:3026` loopback proxy PID38584、private Next3027 PID22940，同一 `stallorder-responsive-20260930` 七容器（API56821／DB56822）。這是使用者手測保留例外，沒有新增第二個Docker環境；3023／55722不操作。原本有界接單旗標到2026-10-03 00:53:24.637台北，期限不延長；LINE記憶體模擬不依賴真實接單旗標。安全啟停／重開見 LOCAL_TEST_SERVICE_LIFECYCLE.md，PIDs是當次收據，使用前必須重新核對。
