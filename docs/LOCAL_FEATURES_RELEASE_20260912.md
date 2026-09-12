# 2026-09-12 本機功能整合發布紀錄

## 狀態與授權

使用者要求將本機功能更新至正式環境，並授權在「不影響另一工作區 DR 發布」的前提下自動完成。這批功能涉及三支 migration 及三張新的複寫資料表；現行流程要求先同步 DR schema，不能判定為完全不涉及 DR。

11:09（台北時間）已與「功能修正與增加」工作區核對：沒有執行中的 DR Apply，DR 網站／provider 發布仍暫停。本次尚未執行遠端 migration、Production 部署、DR Apply、DNS、alias 或環境設定寫入。需要同步的範圍與新 Plan 應在測試完成後交付核對；不得復用先前事故的 Plan 或把一般功能發布視為恢復 DR 網站發布。

## 整合來源

- 本機服務：`Stallorder-Platform-order-selection-checkboxes-20260911`，`952712ea08dd753d09ef21d35c204c28c38bf5c3`，保留 3018／3019／3443 手動 QA。
- 發布分支：`codex/release-local-features-20260912`，獨立 worktree。
- 基底：Staging `b577c431c4a751e0e7fce59cf4866ba103084be3`；當時 main `b2ee581bcaaa7102cc077fb4433a261f0fea7963`，兩者 tree 相同。
- 依序整合 `75c4bef`、`a3dc7c9`、`14a48f7`、`f70cdf5`、`a8f2c8b`、`952712e`。保留 main 已有的 DR 專案身分隔離修正。
- 本次 release worktree 沒有 `.codegraph/`，以目前原始碼與測試核對，未重新建立索引。

## 功能範圍

| 功能 | 正式行為與限制 |
| --- | --- |
| 點餐與商品選取 | 店員、QR、外帶／外送及批次選取恢復打勾式控制；設定用狀態按鈕 |
| 售完期限 | 暫停指定分鐘、今日售完、指定期限、永久下架；到期不增加庫存、不重新啟用永久停用商品 |
| 已列印訂單修改 | 同一張訂單修改品項，保留原單並產生更正單；移除品項標示不製作，版本及重送身分防止覆寫／重複出單 |
| 店員三欄與印表機狀態 | 欄寬隨裝置調整；連線狀態顯示於上方印表機圖示 |
| Web Push | 新訂單才入列；付款、修改、完成及離線歷史同步不新增通知；需正式專用 VAPID／加密設定及使用者裝置訂閱 |
| 店家公告 | 商家設定公告內容／期限；顧客 Menu 顯示，特殊店休提醒優先，不改變下單資格 |
| 本機快速登入 | 僅 development 且 loopback DB 可啟用；正式環境不可使用 |

Web Push 鎖屏音效由作業系統／瀏覽器通知類別控制，不能以網站自訂音檔取代系統通知音。正式環境的必要設定、排程與訂閱須個別驗證，不能以本機裝置已收到通知作為正式環境完成證據。

正式專案的五項 `WEB_PUSH_*` 設定目前皆未存在；既有 `CRON_SECRET` 已存在且同時供 Production／Preview 使用，必須保留。本次應新增 Production 專用 VAPID／訂閱加密金鑰，以 `https://app.qidaigo.com` 為聯絡 URI，驗證程式依已安裝 web-push 3.6.7 的 HTTPS／mailto 規則處理。不得複用本機 QA 金鑰。DR 日後啟用推播也需要相符的解密設定，schema／複寫完成不等於 DR 推播已可用。

## Migration 相容性修正

原本 9/11 的三支 SQL 只曾在保留的本機 QA 資料庫套用。發布候選使用新的 9/12 version；不回寫本機舊 migration history、不修改已知正式歷史。

| 發布版本 | 內容 | SQL SHA-256（LF、trim） |
| --- | --- | --- |
| `20260912112000` | 新增售完截止時間、時區計算與相容 RPC 判斷 | `352c81b7917836624ee395b100f782e07e9dee18ed1667fb696689b2bbfbb570` |
| `20260912112100` | 更正單欄位及唯一索引，保留原單防重複條件 | `a3eddcabf9e3edf53273c9520b23db0d16c1ce82c46108977aad648498c51a48` |
| `20260912112200` | 公告、推播訂閱／工作三表，RLS、最小 service-role 授權及 writer fencing | `a02e9b182ab62fd415e30f20467bf75ea3e40578d0c89747d394874fcd49a01d` |

發布檢查曾正確攔下未知函式／索引替換及 DR schema 內的舊資料 UPDATE。修正方式如下：

- SQL 的相容替換以完整 digest 和限定物件名稱審核，其他刪表、DML、解除 RLS、擴大權限仍拒絕；負向測試保留。
- 原單列印唯一索引於單一 transaction 內替換，原單僅適用 `amendment_id is null`，更正單用另一唯一鍵；5 秒鎖等待／60 秒 statement 上限，失敗整筆 rollback，不提前 promote。
- 舊售完資料的截止時間回填移至 `scripts/sql/backfill-product-availability-deadlines.sql`。只在正式 migration 完成後執行，必須讀到 PRIMARY／ACTIVE_WRITER／writes_enabled／enforcement_enabled，鎖住當前 epoch。DR 經複寫收到結果，schema Apply 本身不改既有資料列。
- 新三表加入既有 DR 複寫 allowlist；一般寫入受 backend writer guard 保護。`orders` trigger 僅 INSERT 入列，排除 `origin` 與舊 `source` 所表示的 OFFLINE_POS。

新增欄位不刪除舊資料，舊應用程式在 promote 前仍可讀原欄位。回退應用程式時保留 additive schema／稽核更正單；不得為回退而刪除正式訂單或 migration history。

## 正式站基準與必要流程

11:09:28（台北時間）讀回 Primary 專案 `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`，Production target 與 `app.qidaigo.com` 都指向 `dpl_43NbkcsahvpA4n5BqUsiPrFA6wtP`，commit `202a3c2debfe8a668177521ea10100c7711b293a`。首頁、商家登入、店員登入及健康 API 均 HTTP 200。

發布依序需要：本機完整檢查 → Staging PR／相同 SHA CI 與隔離 Preview → Staging 驗證 → 相同 tree main → 新 DR schema Plan／Apply → 新 Production Plan／Apply → 增量複寫／DR readiness。DR operator 網站發布、Cloudflare Access／DNS 及 DR Vercel 專案不在本次自動恢復範圍。

每次 provider 寫入前後須核對專案 ID、正式 alias、登入／健康／QR 的實際結果；異常即停止並按 [事故紀錄](incidents/2026-09-12-dr-production-outage.md) 保全正式站。HTTP 200 不代表已完成登入或實際下單測試。

## 本機驗證收據

- 全套單元測試：538 files passed、2 skipped；3170 tests passed、9 skipped。初次失敗已修正舊 fixture／相依契約，以及 DR schema 不可含資料回填的實際發布問題。
- 最終 migration／DR gate 107 passed；HTTPS VAPID 聯絡 URI 的失敗再修正回歸及推播服務 28 passed。
- 146 支 migration 全新建庫成功；72 pgTAP files、1619 tests passed；application schemas lint 無錯誤／警告。
- 從升級前本機備份建立獨立 Primary／DR 測試資料庫；最後三支有明確 transaction 的 SQL 再於 READ_ONLY_STANDBY 成功套用，16 項新增 SQL 斷言通過。Primary 回填成功且保留庫存／永久停用；同樣回填在 DR 被拒絕並保留原資料。
- Chromium、WebKit 各 15 個受影響流程全部通過（分檔收據），涵蓋售完到期、QR 舊購物車、同單號增刪／客製商品、列印中／失敗改單、庫存回復、重送去重、推播及公告；320／390／768／1024／1440 寬度及長者模式有畫面與邊界檢查。
- 公告視窗的 Tab／Shift+Tab 焦點逸出已重現並修正，兩瀏覽器驗證通過。首次 SSR hydration 前點擊以及公告測試使用過期 revision 的失敗屬測試準備問題，已等待互動處理器及使用實際儲存 revision；未放寬正式版本鎖。
- TypeScript、production build、UI audit 通過；ESLint 0 errors、5 個既有 Next 導航 warnings；依賴 audit 0 vulnerabilities。最終 revision 的 CI／Preview 仍須確認，尚不可標記 Released。
- 正式首頁、商家／店員登入及 health 在 11:09、11:41 台北時間均 HTTP 200；這些唯讀檢查不等同實際帳密登入、下單或推播實機測試。

## PR 驗證與修正紀錄

- PR #344 首輪 CI `34672596186` 停在舊的「批次售完」按鈕測試。已改走「批次供應設定 → 今日售完 → 確認」實際流程，並驗證截止時間已儲存、庫存份數保持不變；本機重測通過。
- 商家模組完整流程已更新按鈕名稱並通過本機驗證。保留的備份 fixture 因大量舊測試訂單而自動暫停點餐，重測僅在獨立 scratch DB 準備開店／QR 啟用條件；完成後已還原原暫停狀態與容量設定，不修改正式限流或營運規則。
- 勾選框改小後，共用商品與攤位商品列表缺少足夠觸控範圍，已由失敗的實際頁面測試重現並補上 label。勾選圖示保持 24–28px，正常／長者模式可點範圍至少 44／56px；測試包含點外緣、Space 切換及各尺寸不溢出。
- CodeQL 曾指出測試中的說明網址正規表示式過寬，已改成精確 URL 比對。`3b96c17` 的 CodeQL 通過，分支未結案警示為零。
- `3b96c17` 的隔離 Preview `34672596121` 通過：72 files／1619 pgTAP tests、部署／翻譯 smoke、合成 OAuth 與外送流程。唯讀 smoke 原始 20/20 含兩項 skip（Preview 不測正式 root／WWW，未提供正式專用 QR），實際執行 18 項；health 為 ok／DEGRADED。此收據不得替代後續變更 SHA 的 CI／Preview，仍須全套重跑。

本次證據目錄：`C:/Users/KY/.codex/visualizations/2026/09/06/01a0761b-0cdb-73e1-82cc-59a3e93d5d66/release-local-features-20260912`。

## 測試服務收尾

- `stallorder_release_primary_20260912`、`stallorder_release_dr_20260912`、`stallorder_release_dr_wrapped_20260912` 位於已使用中的本機 `supabase_db_stallorder-catalog-ops-20260907`／55722，只保留合成 QA 資料，未啟用排程。
- 全新建庫專案 `stallorder-release-qa-20260912`／55821 起的八個容器已按 project label 確認並全部停止；容器、映像、volume 與測試資料保留。重新驗證時可從證據目錄 `fresh-db` 啟動該專案，完成後再停止同一 project 的容器。
- 本次 app 3028 已按程序鏈停止。使用者保留的 3018／3019／3443 手動 QA 與其他工作區服務保持原狀。
