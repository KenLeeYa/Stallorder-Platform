# StallOrder 共用契約與回歸護欄

本文件整理跨工作任務反覆出現的錯誤。它不是完成狀態清單；每次修改仍須依目前 revision、資料與環境重新驗證。

## 使用方式

1. 先找出此次修改落在哪一個「變更觸發器」。
2. 把該列所有相依面加入 acceptance cases；不能驗證者標示 `not evaluated`，不可默認沒有影響。
3. 先新增會失敗的聚焦契約／回歸測試，再做最小修正。
4. 共用元件要驗證所有消費端，不可只測提出問題的那一頁。
5. 新的穩定要求須同步更新 `product-requirements.md`、`qa-matrix.md` 和必要的衝突決議。

## 不可再次違反的最新決議

| 主題 | 最新契約 | 常見錯誤 |
|---|---|---|
| 跨攤位報表 | 有報表權限時，單攤與多攤組織都要看到「跨攤位報表」入口；單攤只隱藏頁內真正需要多攤的比較／批次功能。 | 用 `singleStallMode` 把整個入口一起隱藏。 |
| 商家登入預設頁 | 已完成開店設定後進多攤位營運總覽；開店設定留在攤位管理。 | 只修前端按鈕，登入 redirect 邏輯仍回 onboarding。 |
| KDS 關閉 | 顧客公開外帶／外送單經店員確認後，仍有明確「完成訂單」動作；完成才是可取餐並通知顧客。 | 把「確認」當成「完成」，或因 KDS 關閉而沒有 terminal action。 |
| 列印 | 57mm 正式票只印重要資訊；`[A1]`…`[A4]` 是修改對照標記，不得列印。 | 把設計註記或過大行距帶到正式票。 |
| 分頁 | 所有大型清單預設每頁 5 筆；登入裝置固定 5 筆且不提供筆數選擇。 | 沿用早期 10 筆預設或一次載入全部資料。 |
| 攤位設定 | 取消重複「詳細資料」折疊；短設定直接顯示，長流程改群組、子頁或可捲動 modal。 | 每個小區塊都包一層 accordion。 |
| 公開語系 | 選擇非中文語系後，分類、群組、商品、店休公告與新功能字串都不可漏回中文。 | 只翻 UI shell，動態商品／公告仍用來源中文。 |
| 店員商品導覽 | 依已設定順序只顯示商品群組導覽，不重複同名分類與群組。 | Staff 用不同 mapping，再顯示兩層重複項目。 |
| iPad 列印 | 先依瀏覽器、傳輸與印表機能力判定；配對藍牙或插上 Lightning 不等於 Safari 可直接列印。 | 未做實機／vendor transport 證據就宣稱支援。 |
| 外帶售完修改 | 只允許未付款且未進入製作／列印鎖定的公開外帶單；必填原因與顧客訊息，server 重算金額、留稽核並即時通知顧客。 | 只改前端明細、沿用舊總額，或已出單後仍可任意改品項。 |
| 顧客已到店 | 等待顧客回覆改時間時，可用「顧客已到店」銜接原結帳；KDS 開啟須已完成製作，且仍要取餐碼與付款驗證。 | 把到店當成跳過 KDS、取餐碼或付款的捷徑。 |
| 外帶提前時間 | 公開外帶最少提前 5 分鐘，DB、API、設定表單與既有資料正規化一致。 | 只改輸入框最小值，server 或舊資料仍接受小於 5 分鐘。 |
| 外送說明 | 商家可設 500 字內純文字；只在外送進入時顯示置中、可關閉且依語系呈現的提醒。 | 在 Menu／外帶也彈出、允許 HTML，或空白內容仍遮住點餐。 |
| DR Vercel SSO | Create 不帶 `ssoProtection` 且 project 尚未連 Git／domain；驗證精確 ID 後 PATCH `all` 並 read-back，成功後才可 link/deploy/domain/DNS。 | Create 直接帶 SSO、先綁資源再補保護，或失敗時降級成 `all_except_custom_domains`。 |

## 變更觸發器與相依面

### 導覽、角色或模式顯示

一旦修改 header、navigation、role、mode、stall count 或 feature flag：

- 檢查 Merchant、Staff、Kitchen、Platform Admin 的 server authorization 與 UI visibility 是否一致。
- 檢查單攤／多攤、模組開／關、純角色／Merchant 代入角色、直接 URL、返回來源。
- Desktop 與 mobile 若共用 renderer，測試要覆蓋兩個輸出；若不同 renderer，兩邊都要有契約測試。
- 隱藏入口只能改善可用性，不能當成權限控制；server route 必須獨立拒絕未授權者。
- 320、390、768、1440 寬度都要確認：一列、可水平捲動、圖示等大、邊框完整、最後一個動作仍可觸及。

### 訂單狀態或動作

任何 order status、確認、開始製作、包裝、完成、取消、付款更正或修改訂單變更，都要畫出並驗證：

```text
Customer/Menu/QR
  -> order API/state machine
  -> Staff board
  -> KDS (enabled/disabled)
  -> print job (enabled/disabled/failure/retry)
  -> ready sound + pickup-code overlay
  -> payment/cash drawer
  -> reports/cash handoff/product analysis
  -> audit/notification/reconciliation
```

- 四組 KDS/列印開關都必須有可到達的 terminal path，不能留下隱藏 active job。
- 顧客追蹤須自動同步；SSE／stream 只有一個 owner，並有 bounded polling fallback、stale 狀態與重試。
- 修改原訂單使用 version/lock/idempotency，失敗保留原單；不可用 timeout retry 建出第二張單。
- 店員修正公開外帶品項時，驗證未付款、來源、狀態、KDS／列印鎖；要求處理原因與顧客訊息，server 重算全單並撤銷尚未執行的舊列印工作。
- 「顧客已到店」只解除等待改時間回覆：KDS 開啟時需訂單與品項皆 ready，KDS 關閉走明確人工完成路徑；原取餐碼、結帳與稽核不可略過。
- 完成訂單只允許權限範圍內的取消與付款方式修正；商品、選項與數量不可跟著被改。
- 高風險動作驗證經理授權碼，並記錄 actor、reason、old/new、order、time；不能只靠前端 modal。
- 預約提醒、一般新單與可取餐提醒要分辨事件與聲音；瀏覽器音效需先解鎖，且永遠保留閃爍／高亮、離線、重試與確認 fallback。

### 商品、群組、排序或語系

改動分類、群組、商品、套餐、註記、排序、publication 或 translation 時，一次檢查：

- 共用商品管理、攤位商品指派、Merchant 預覽。
- 公開 Menu、QR 點餐、外帶、外送。
- Staff 點餐與已加入購物車。
- KDS／廚房品項顯示、列印票據與報表群組統計。
- 語系偵測、手動切換、快取 key、menu/catalog version、缺翻譯 publication gate。

排序由同一份 server-authoritative sequence 產生；任何消費端不得各自以名稱、建立時間或 ID 重排。非中文 locale 缺翻譯時要在發佈前提示，不可靜默混回中文。

### 公開 Menu、營業狀態或快取

- 返回 Menu、切換外帶／外送、頁面恢復與 service worker cache 都要重新驗證營業時間、店休、臨停、預約規則、商品版本與售罄。
- 「非營業但可預約」、「店休」、「服務暫停」、「網路中斷」是不同狀態與訊息。
- 顧客姓名、電話、日期時間與服務區域驗證同時在 client 與 server 執行；server 才是權威。
- 公開外帶最少提前 5 分鐘，不能只靠 client `min`；migration/default、正規化與 API validation 必須一致。
- 外送自訂說明只在 delivery mode 顯示置中 modal；空字串不顯示，500 字上限與純文字 escaping 在 server/client 都驗證。
- QR／外帶／外送商品群組列固定在共用 header 下方；section scroll offset 必須同步，不能遮住商品、公告或結帳控制。
- 新增 UI 字串時同步 central messages、所有啟用 locale、錯誤狀態與 accessibility name。

### 圖片上傳、預覽與裁切

圖片工作不是只完成 API 上傳。完整契約包含：

1. 選檔後立即顯示本機 preview；
2. MIME／magic bytes、5MB、pixel dimension、orientation、資源限制驗證；
3. bounded modal 內拖拉、平移、縮放、裁切、取消；
4. 壓縮成 bounded WebP，不放大、不保存過大原檔；
5. 上傳成功字樣與存檔後生效說明；
6. reload 後仍顯示確認裁切；
7. 可刪除並清掉資料參照與受管 storage object；
8. 預期錯誤永遠回 JSON，client 先檢查 content type。

商品圖片與 Menu 文宣圖共用安全處理契約，但文宣圖的 focal point、響應式容器與顯示位置要獨立驗證。不要只測 upload response 而未測公開 render URL。

### 列印、印表機與錢櫃

先建立 capability matrix，再顯示設定與動作：

| 層 | 必須證明 |
|---|---|
| 裝置／瀏覽器 | iPadOS/Safari 可用的 browser API 或 vendor-supported handoff。 |
| 傳輸 | Ethernet、CloudPRNT、vendor URL scheme／Web protocol、approved bridge 或 native；藍牙配對／USB 連線不是 transport proof。 |
| 印表機 | 型號、紙寬、切刀、蜂鳴器、狀態回報、cash-drawer pulse capability。 |
| 工作 | 自動列印、copy/routing、retry/callback、manual reprint 的 idempotency。 |
| 實體 | MCP31LB 實機列印、57mm 紙、斷線、缺紙、重連、重複 callback、錢櫃 RJ11/RJ12 實測。 |

- Browser 無能力時顯示「不支援／需要設定」，不能把 print dialog 當成 raw receipt proof。
- 付款成功、列印成功與錢櫃開啟是三個可觀測結果；任一失敗不得偽造另一個成功／失敗。
- 正式能力聲明需要實機與同版本 iPadOS/Safari 證據；source review 或 mock 只能標 `not evaluated`。

### 報表、歷史清單或指標卡

- Server query 必須 tenant-scoped、date-bounded、stable-sorted，不能只在 client slice 分頁。
- 預設 5 筆；翻頁後 filters、日期、sort、stall、scroll/return context 不遺失。
- 登入裝置固定 5 筆，只有超過 5 筆才顯示分頁，沒有 page-size selector。
- All Orders／完成訂單預設本地今日，另提供日、週、月與合法日期區間。
- 趨勢、攤位比較、付款分析、現金交班採同一 metric-card responsive grid。
- Product analysis 的群組、全組織熱銷、各攤熱銷可獨立折疊，但下載／查詢仍受相同 filters 與 tenant/date scope。
- 對資料庫熱門查詢記錄 query count、duration 和 index/EXPLAIN；避免一次載入全部再前端分頁。

### 設定頁、feature flag 或登入方式

- 先找出 DB setting、service contract、API、form、message catalog、runtime consumer 和 audit；不能只新增開關外觀。
- 關閉功能要保留歷史資料與對帳，不要刪除；開啟前驗證相依設定完整。
- 未接通的付款、Passkeys/WebAuthn、外送 provider、電子發票或其他 provider 模組保持隱藏／disabled，且 direct API fail closed。
- Google 登入是否顯示同時取決於 Platform policy 與 runtime credentials；缺設定時提供 Admin 診斷，不能讓商家陷入唯一不可用入口。
- 商家說明用短句回答「這是什麼／要做什麼」，技術細節移到 Platform Admin 或診斷頁。

### 電子發票與外部 provider

- 商家訂單發票與平台訂閱帳單發票完全分域。
- organization/stall/order/invoice/provider job 使用資料庫可驗證的 tenant relationship，不靠 client organization ID。
- issue、void、allowance、refund/retry 都有 idempotency、state transition、audit、reconciliation。
- local mock、contract-only、sandbox、Production issue 是獨立旗標；沒有憑證／認證／Staging evidence 時 provider writes 保持關閉。

### DR Vercel project、domain 或 DNS

- `Create Project` payload 不含 `ssoProtection`，初始 project 必須未連 Git、未部署、未綁 custom domain／alias／DNS。
- 後續 mutation 只使用 Create 回傳並驗證過的精確 project ID；不得靠 project name、URL 或列表排序猜測。
- `Update Existing Project` PATCH `ssoProtection.deploymentType=all` 後，GET/read-back 同一 ID 必須仍為 `all`，才可開始 link、deploy 或 domain/DNS mutation。
- PATCH/read-back 任一失敗，只刪除本次精確 project ID，確認 rollback 完成後停止；禁止降級成 `all_except_custom_domains`。

## 響應式與可用性固定規格

- phone/tablet 的共用操作列優先小圖示一列；desktop 可顯示短標籤。
- 圖示視覺尺寸、按鈕外框與 hit area 一致，hit area 至少 44x44 CSS px。
- 只有操作列可 intentional horizontal scroll；整頁不能橫向溢位。
- 語言與主題切換同列對齊，不因 locale 字長把登出、購物車或確認動作推走。
- Modal 有固定 header/close、內部 body scroll、可見 footer actions、focus trap/restore；不能讓內容逐字換行。
- 長雙欄頁面各欄獨立捲動；phone/tablet 改成獨立按鈕＋modal／dedicated view。

## 本機工作樹與測試服務

- 每次先記錄 repo、branch、HEAD、`git status`、worktrees 和實際占用測試 port 的 process/cwd。
- 多個工作任務共用 dirty worktree 時先劃分檔案 ownership；任何 build 前等待 `worktree stable`。
- 歷史 Docker Desktop log 不代表目前錯誤。先查 daemon、container、port、health、process start time 與最近 log timestamp；不要直接刪 container/image/volume。
- `git clean` 前先 `git clean -d -n`，逐項說明用途、大小、能否重建；沒有逐項選擇不得刪除 `.agents`、`.codex`、audit artifacts 或其他 untracked data。
- 本機 LAN／business-hours bypass／測試帳密／mock 只可在明確 local guard 下使用；Production build 必須證明不可到達。

## 完成判定

不能只回答「已修改」。至少留下：

- exact worktree、revision/tree、服務 URL 與資料 fixture；
- requirement IDs、QA case IDs 與相依面清單；
- red reproduction、focused pass、必要的 full gates；
- 320/390/768/1440 與至少一個非中文 locale；
- JSON failure、offline/retry、permission-negative、idempotency/concurrency；
- 實體硬體／外部 provider 未驗證時清楚標示 `not evaluated`；
- 本機、Staging、Production 狀態分開，禁止用本機 build 冒充已發布。
