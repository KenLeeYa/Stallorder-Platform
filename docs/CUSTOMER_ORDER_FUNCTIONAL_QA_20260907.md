# 顧客與店員訂單流程 QA（2026-09-07）

## 範圍與環境

針對「拒絕第一次改時 → 店員再提第二次時間 → 顧客閒置卻跳操作過於頻繁」追查真因，並依使用者追加要求，擴充可預測的顧客、店員、庫存、營業時間、出餐與付款連動測試。

- 執行分支：`codex/catalog-operations-20260907`，起點 `24c6d5138e233ed7b7a270b7a0789d05ff2524e2`。
- 本機應用：`http://127.0.0.1:3018`；獨立 Supabase lab `stallorder-catalog-ops-20260907`，API 55721、PostgreSQL 55722。
- 原主工作區的未提交檔案不納入此次修正；介面重設計仍保存在 `codex/responsive-workflows-20260907` 的 `0cb5540727733515bdfaa26b9ae5b2f3d0a986a8`。
- 維持前次還原的操作版型。本次變更是功能修正及必要的狀態提示，沒有重新套用整體介面設計。
- 本紀錄不是正式環境部署收據。資料庫 migration、Edge function 與應用程式須一併納入後續受保護的版本發布；目前只套用到上述本機 lab。

## 已重現的缺陷與修正

### 1. 正常背景查詢消耗錯誤的配額

顧客追蹤頁每 3 秒查詢一次，即每 5 分鐘約 100 次。原有 `TRACKING` 全域限制卻包含每筆追蹤行為 60 次／300 秒，以及來源 IP、裝置各 120 次／300 秒。同一顧客不操作也會在約 3 分鐘耗盡配額；同店 Wi-Fi 還會互相占用來源配額。

真實 Playwright 流程在修正前約 3.1 分鐘收到 429。沒有清除測試中的配額來迴避錯誤。

新增 `check_public_order_tracking_gate`：

- 只有資料庫確認追蹤 token hash 與裝置 hash 綁定存在，才使用單筆訂單／裝置的 60 次／60 秒讀取配額。
- 多分頁、Node 與 Edge 共用同一個配額。正常單分頁約 20 次／分鐘；有效訂單之間不共用讀取配額。
- 無效憑證仍走原有全域防濫用限制，取得訂單資料仍須原有裝置驗證；沒有降低匿名、修改或取消的防護。
- 429 提供 `Retry-After` 與 `retryAfterSeconds`。既有讀取故障、手動重整、切回分頁、恢復網路及排隊中的更新，都不得跳過等待期限。
- 同步失敗顯示持續的行內狀態、保留最近訂單資料並自動恢復，不再把背景查詢當成人為操作錯誤反覆彈窗。

修正後相同流程實際閒置 366 秒，126 次讀取全部成功；再注入短暫 429，確認期間可回覆新時間、按鈕立即依伺服器回覆更新，讀取稍後自動恢復。

最終再以穩定建置版、實際 Edge 查詢重跑：366 秒、125 次讀取全部成功；短暫 429 的等待、期間接受新時間與自動恢復亦通過。兩次各跨過完整五分鐘視窗。

### 2. 店員改時與取消同時發生

原本店員路由先讀取訂單狀態，寫入時只比對提案版本。另一個交易在此期間取消訂單，提案版本未變，`PROPOSE` 和 `CONFIRM_REQUESTED` 都可能繼續寫入成功。

新增真實 PostgreSQL 交易測試：取消交易先持有訂單列鎖；啟動店員請求，確認已等待該列鎖後提交取消。修正前兩種操作均錯誤回傳 200。

修正為寫入時同時比對訂單狀態；新提案也比對當時的時間協調狀態。狀態已改變就回傳 409，交易不寫入新提案或成功事件。`CUSTOMER_PRESENT` 既有的狀態比對保留。

### 3. 無效裝置錯誤被紀錄程式變成 500

Node 追蹤驗證失敗時會紀錄 `TRACKING_READ / ORDER_NOT_FOUND`。既有 `recordPublicOrderAttempt` 使用 Prisma `$queryRaw` 讀取 PostgreSQL `void`，造成 `P2010: Failed to deserialize column of type void`，掩蓋真正的 404。

將回傳欄位明確轉為可解析的 `text`，保留拒絕紀錄。跨 Node／Edge 測試確認錯誤裝置拿不到訂單資料，回傳明確 404；有效訂單查詢和修改不受影響。

### 4. 舊回覆訊息污染新一輪時間協調

顧客接受一次新時間後，店員再提案，畫面仍留下前一輪「已接受店家提議的新時間」。新增測試先重現這個矛盾。

回覆訊息綁定提案版本；新版本不再顯示舊版成功訊息。成功回覆採伺服器狀態立即更新，延遲抵達的舊查詢不能讓已回答的按鈕重新出現；過期或已變更的回覆保留相應錯誤說明並刷新。

另以真實回覆先提交、再中斷瀏覽器回應，重現「伺服器已確認，畫面仍留下失敗訊息」。只有網路中斷／逾時這類結果不確定的錯誤，才會在查得同版本已接受或拒絕後清除；明確的過期、版本衝突錯誤不會一起被消除。

### 5. 本機備援驗證設定缺項

本機 `.env.local` 原有 Supabase URL 與匿名公開金鑰，但缺少 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_FUNCTIONS_URL`、`NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL`。一般查詢走 Node 能成功，無效裝置或刻意模擬 hash 差異時才會進入 canonical Edge 驗證，因缺少設定而變成 503。

已從同一個 55721 本機 lab 的既有公開設定補齊這三個別名，並重新啟動本機應用。沒有讀取、輪替或修改正式密鑰。E2E 另以 `LOCAL_CANONICAL_DRIFT_TEST=true` 驗證正確裝置能透過 canonical Edge 回覆，錯誤裝置仍拒絕。這是本機設定修復，不是放寬裝置驗證。

## 執行結果

以下只列入實際完成的檢查；專用環境限制及硬體驗收另列於後方。

共 42 個不同的瀏覽器案例通過：34 個訂單／功能流程，加上恢復本機開發入口後的 8 個可操作性檢查。

| 層級 | 範圍 | 結果 |
|---|---|---|
| 真實長時間流程 | 拒絕、重新提案、6 分鐘閒置、暫時 429、等待後恢復、等待期間回覆 | 通過：開發版 126 次、最終建置版 125 次成功讀取，各 366 秒，無背景錯誤彈窗 |
| 新增功能 QA | 店員平板實際改時、多分頁、慢回應、離線恢復、逾時、回應遺失、重複指令、取消、共享網路、Node／Edge、併發取消 | 7 項全部通過，包含最後補入的回應遺失訊息修正 |
| 既有完整流程回歸 | QR／Menu 修改、確認鎖定、庫存、店休、QR 啟閉、成員、音效、付款、KDS／列印、桌位與裝置尺寸 | 26 項通過；catalog 7 項在開發版，其餘 19 項在穩定建置版 |
| 恢復開發入口 | 四種角色登入、公開 Menu／QR／外帶自取／現金交班、印刷、還原版型、非營業時間預約導向 | 8 項通過；臨時雙通道旗標已移除，本機 3018 恢復開發模式 |
| Vitest | 全庫單元與契約測試、提案狀態、授權、付款、庫存、設定及拒絕路徑 | 527 檔、3038 項通過；另 2 檔共 9 項有指定環境限制，見下方 |
| pgTAP | 全部資料庫測試、綁定讀取配額、權限與資料交易 | 70 檔、1589 項全部通過，包含新增的 17 項 |
| 工程檢查 | ESLint、TypeScript、UI audit、build、資料庫 lint、依賴與密鑰檢查 | lint、typecheck、UI audit、build、DB lint、Gitleaks、production guardrails 通過；依賴 audit 0 漏洞 |

## 測試案例與依賴

| 使用者可預測情境 | 驗證重點 | 自動化位置 |
|---|---|---|
| 同一訂單連續修改三次、含未增加餐點 | 訂單不重建；原姓名電話、價格、庫存差額正確 | `customer-order-lifecycle.spec.ts`、`qr-edit-local-flow.spec.ts` |
| 店員確認時顧客仍在修改 | 伺服器擋下修改，顯示已確認說明 | `customer-order-lifecycle.spec.ts`、`public-order-edit` tests |
| 顧客拒絕後再提案、閒置 | 正常頻率不耗盡自己的讀取配額 | `customer-tracking-idle-local.spec.ts` |
| 同訂單多分頁、同店網路多張訂單 | 回覆只生效一次；有效訂單不互相耗盡配額 | `customer-order-functional-qa-local.spec.ts`、`public_tracking_polling.test.sql` |
| 限流時重整、切換分頁、恢復網路 | 尊重冷卻時間，不立即重試形成循環；載入狀態會結束 | `use-live-resource.test.ts`、長時間 E2E |
| 回覆比舊查詢先完成 | 立即顯示可信成功狀態，舊查詢不能復活按鈕 | 新增功能 QA E2E |
| 提案過期、重複／舊版本回覆、無效裝置 | 具體錯誤碼；無重複事件、無資料外洩 | 新增功能 QA E2E、`fulfillment_time_coordination.test.sql` |
| 回覆已寫入但網路回應遺失 | 自動讀回已提交狀態、清除不確定錯誤；重新送出不重複紀錄 | 新增功能 QA E2E |
| 新一輪提案到達 | 清除前一輪成功訊息，仍需確認新時間 | 新增功能 QA E2E |
| 店員提案／確認與取消同時操作 | 以提交當下狀態拒絕過期寫入 | 新增功能 QA E2E 的兩個真實列鎖測試 |
| 商品售完、最後一份、預約占量、取消與製作 | 不超賣、增減差額、取消回補一次、已製作不回補 | `catalog-operations-local.spec.ts`、`stall_product_stock.test.sql` |
| 預約第 N 天、特殊營業／店休、最後點餐 | 含第 N 天；特殊日期／時間限制優先 | catalog、calendar、closure 測試 |
| 先印桌位 QR 再啟用內用 | 不需重新印製；停用或撤銷仍有效卡控 | catalog operations E2E |
| 新單、修改、結帳、完成、舊快照再出現 | 只有新單觸發店員新單提示音 | `local-order-experience.spec.ts`、alert reconciliation tests |
| 收款、取餐驗證、出餐／完成 | 明確區分付款與交付，不漏單、不重複付款 | QR cash checkout、dine-in、KDS/print E2E 與 DB tests |

## 本機驗證的界線

- 瀏覽器尺寸與音效觸發能自動驗證；iPad 真機鎖屏／休眠後的喇叭播放、Safari 背景限制仍需實機確認。
- 實體印表機、錢櫃、真實支付商及 LINE 收件由對應硬體／供應商驗收覆蓋，本次不發送真實顧客訊息或交易。
- Staging、Production、DR 的部署與實際流量結果不是本機測試的涵蓋範圍。
- `circuit-ab-db-replay.test.ts` 與 `circuit-ab-terminal-matrix.test.ts` 共 9 項只允許專用 56322 replay 資料庫，本次 55722 lab 未啟用這兩個 harness；不修改其隔離防護、不把 skip 計為 pass。此次 Node／Edge、canonical hash 差異、回應遺失等行為另由上述真實本機 E2E 驗證。
- 後續訂單流程變更須重跑 `QA-QR-15`／`QA-QR-16`，並依影響執行 `QA-QR-08`、`QA-OPS-*`、`QA-EXP-*` 及 KDS／付款／列印相關矩陣；不可只驗證單次成功送出。

## 測試前置條件

- 資料庫變動案例使用單一 worker，建立自己的訂單、商品或臨時設定，並在結束後還原。內用英文流程明確準備兩個已翻譯商品及其包裝備註，不再依賴整間示範店所有商品已完成英文翻譯；沒有移除產品端的翻譯完整性檢查。
- 本機 `next start` 驗證只監聽 `127.0.0.1:3018`，啟動前驗證 API 55721／DB 55722；使用 Turnstile 公開測試 site key、暫時的本機稽核雜湊值及到期式雙通道測試設定。這些不加入正式設定；驗證後恢復開發伺服器與原有功能旗標。
- 建置模式第一次啟動缺少本機稽核設定、測試 site key，以及英文案例缺少翻譯資料，均屬測試前置條件失敗，修正前不算通過。開發伺服器熱更新中斷回應也不視為已驗證成功；改用穩定建置重測。
- `local-qa-readiness.spec.ts` 原先仍要求商家 QR 區占滿平板寬度，並比對「前往線上 Menu 預約」舊文字。依使用者最新的介面還原要求，改驗左側管理欄、無橫向溢出、44px 印刷連結及正確紙張路徑；「線上 Menu 預約」實際點擊後須前往外帶自取網址。沒有為通過舊測試重新套用改版介面。

## 測試收據

本機詳細輸出保存在 `C:\Users\KY\.codex\visualizations\2026\09\06\01a0761b-0cdb-73e1-82cc-59a3e93d5d66`。多次執行相同案例只計一次通過，途中失敗的批次不整批計為成功。

| 收據 | 證據 |
|---|---|
| `tracking-idle-before.log`、`tracking-idle-before-trace.zip`、`tracking-idle-before.png` | 修正前真實約 3.1 分鐘觸發 429 |
| `tracking-idle-after.log` | 首次修正後 366 秒／126 次讀取，包含注入 429 後恢復 |
| `functional-qa-lost-feedback-before-2.log` | 回覆提交後遺失回應，錯誤訊息未清除的失敗案例 |
| `functional-qa-regression-1.log` | catalog 7 項通過；後續 canonical 設定缺項另修復並重跑 |
| `functional-qa-regression-build-2.log` | QR／PREORDER 兩項完整 lifecycle、canonical drift 通過 |
| `functional-qa-regression-build-5.log` | 新單音效、免洗餐具、預約店休與停機遮罩兩項通過 |
| `functional-qa-regression-build-6.log` | QR／外帶自取畫面修改兩項通過 |
| `functional-qa-regression-build-7.log` | 其餘 13 項內用、收款、找回、Menu 時段、KDS／列印、尺寸與排程併發全部通過 |
| `functional-qa-final-workflows-2.log` | 最後 8 項全部通過（7.2 分鐘），含 Node／Edge 異常情境及 366 秒／125 次讀取；攔截同時涵蓋 Node GET 與 Edge POST |
| `functional-qa-restored-readiness-final.log` | 本機開發入口恢復後 8 項全部通過（28.4 秒） |
| `functional-qa-unit-verified.log`、`functional-qa-db-tests.log` | 3038 單元／契約測試、1589 pgTAP |
| `functional-qa-build-final.log`、`functional-qa-typecheck-verified.log`、`functional-qa-lint-verified.log` | 最後程式建置、TypeScript 及 ESLint |

## 後續重跑方式

先確認使用獨立的本機 55721／55722 lab 與本分支設定。開發入口使用 `npm run dev:qa -- --port 3018`；另一個 PowerShell 終端可執行：

```powershell
$env:PLAYWRIGHT_APP_URL = 'http://127.0.0.1:3018'
$env:PLAYWRIGHT_REUSE_EXISTING_SERVER = 'true'
$env:PLAYWRIGHT_PRODUCTION_SERVER = 'false'
$env:LOCAL_CANONICAL_DRIFT_TEST = 'true'
npx playwright test e2e/customer-order-functional-qa-local.spec.ts e2e/customer-tracking-idle-local.spec.ts e2e/customer-order-lifecycle.spec.ts --workers=1
```

長時間案例有真實 6 分鐘等待；不可縮短到舊配額視窗以下，也不可在等待期間清空 rate buckets。若修改庫存、日曆、收款、KDS 或列印，另重跑上表對應的完整流程檔案。
