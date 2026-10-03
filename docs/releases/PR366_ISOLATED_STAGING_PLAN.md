# PR366 隔離 Staging 驗證方案

## 必要性

2026-10-03 讀回 GitHub staging 的 SUPABASE_PROJECT_REF 為 `daeqwtpaxcebmtwxqdkj`，與目前正式 DR 相同。不得把候選 migration、seed 或測試訂單寫入這個舊 Staging 目標。原 PR365 的 24 小時測試授權與資源已到期，不沿用。

## 可審核操作

- 候選：PR366，分支 `codex/integrated-production-20261002`，執行時綁定最新通過 CI 的完整 SHA/tree。
- 沿用既有 Supabase Pro 組織與 Primary parent `eyuctbnlvnbnivwasvqr`，只建立一個 data-less Micro child branch；不改 parent、DR、Production 或本機資料。
- 沿用 Vercel project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`／team `team_MMfsiG94K9Zy3e6w7Ccc9xY4`，只建立配對 Preview 部署；不綁 Production alias、不改共用 Preview／Production secret。
- 使用 repository 既有 Ephemeral Preview Validation workflow，精確 `manual-<run_id>` ownership，記錄 branch/deployment IDs。Preview required reviewer 保護維持。
- 只生成隔離測試所需伺服器 secrets，限定 child／該 deployment 使用；不注入 OA／Pay 真實憑證，不傳真實訊息、不做真實金流。
- 驗證 fresh migrations、pgTAP、租戶與角色權限、登入、營業時間公開訂單拒絕、staff POS、共用商品／通知與介面；讀回配對 source/tree 與資料庫指紋。
- 新增費用管理預算 US$1、最長 6 小時，Micro 基本運算粗估約 US$0.08／6 小時，其他用量另計；這是管理限額，不是供應商硬性上限。
- 結束／失敗／期限或預算到達即清理精確 child 與 Preview 部署；保留脫敏 QA 證據與本機資料。不自動延長、不新增第二組資料庫。

## 邊界

2026-10-03 使用者已核准上述 US$1／6 小時配對 Preview 範圍。核准不代表資源已建立或 QA 已通過；仍由協調者擔任唯一遠端 writer，先配置到期清理，再記錄精確資源與部署讀回。

本方案尚未建立上述雲端資源。Production 發布仍須所有必要檢查及新 Plan/Apply；隔離驗證成功本身不是正式發布成功。使用者指定延後的治理設定持續 OFF／dry-run。

## 配對 Preview 的最小瀏覽器 QA 矩陣（PENDING）

每項須記錄同一 child、deployment、完整候選 SHA/tree、帳號 scope 與結果；下面是待執行驗收，不是 PASS 收據。

| 範圍 | 必要實際使用案例 |
| --- | --- |
| 登入與權限 | owner／staff／kitchen／platform admin 登入授權頁；匿名、跨組織及越權拒絕。 |
| 共用商品 | 320／390／768／1440 排版；搜尋＋分頁後編輯儲存／取消回原位置；儲存失敗保留對話框與原清單。 |
| 通知中心 | 商戶／店員鈴鐺狀態、未讀→已讀、返回正確 scope；換身分／撤權清除私人狀態。 |
| 長清單 | Supply、損益、排班、行程、發票用 child 專用密集資料；手機 6→更多→收合、桌面完整，末筆可操作且摘要按完整資料。 |
| 功能列與 POS | merchant／staff 各寬度功能列、搜尋、切換模式及結帳；店員外送與內用設定各自重新驗證。 |
| 公開接單 | DEFAULT／DELIVERY 開店成功；閉店 session／送單／增量拒絕且資料不變、減量允許；跨午夜、截止時間、有效預購及既有 staff POS 行為。 |
| LINE 本機模擬邊界 | Hosted Preview 的 `/local-qa/line` 必須 404。四階段 MINI／OA mock 只留本機證據，不放寬 local guard；不計為真 LINE 登入、OA 送達、Pay 或實機掃碼。 |

seed 測試身分為 `owner@stallorder.test`、`staff@stallorder.test`、`kitchen@stallorder.test`、`platform.admin@stallorder.test`，密碼 `StallOrderDemo!2026`；僅用於隔離 child，不是正式商戶帳號。測試前須讀回角色／scope、配對 DB／Edge／部署 origin、Preview bypass、接單 rollout override 與 Supply 資格／開關；不能只依環境變數推定能力已啟用。治理持續 OFF／dry-run，LINE／Pay 真實能力 OFF。

現有 `staff-pos-line-delivery.spec.ts`、商品與響應式測試可作驗收來源，但含本機 Prisma／精確 target fixture 的測試不可直接換 URL／連線指向遠端。移植前須加精確 child／owner guard、限時測試資料與還原收據，不改正式 seed，不掩蓋閉店負案。`catalog-note-settings-feedback-responsive.spec.ts` 僅覆蓋部分設定介面，不能替代商品 edit-return 驗收。

目前 workflow 的 pgTAP、readonly smoke、OAuth／delivery synthetic smoke 仍缺上述完整 browser cases 與安全的 child fixture；狀態為 PENDING。先前本機／mock／CI 結果不自動轉為本次配對 Preview PASS。6 小時外部期限清理須在獲准且建立資源前由協調者配置；workflow 的收據與 finally 清理不等同獨立到期保障。

## 2026-10-03 測試準備進度

已補上精確 provider／DB 綁定檢查、密集清單與 QR fixture，以及實際角色登入、商品儲存讀回、現金開班／POS 與營業／休息階段的測試程式。這是準備結果，尚無本次遠端執行結果。未完成的通知已讀、發票及跨午夜等案例仍不得計為通過。

公開點餐 Web 與 child Edge 共用本次生成的隔離雜湊密鑰；Turnstile 僅使用明確 test 模式的官方測試設定，不能計為真實驗證服務測試。QR、session 與 tracking token 只存 runner checkout 外的私有暫存目錄，不上傳 artifact，結束時移除。營業時間階段還原核對 open／closed 收據連續性及精確 updatedAt，失敗路徑交由 child finally 清除，不宣稱條件還原已通過。

到期清理 heartbeat `pr366` 已設定；尚未建立 child 或 Preview，尚無 owner 收據或新增雲端資源費用。資源建立前須綁定最新可接受的 CI／Web 證據，並記錄唯一 manual run 與六小時期限。

## 新增發布阻擋：未修補的 Web 開發依賴漏洞

2026-10-03 Linux Web Install Scope Proof run `37084954668`（候選 `182bd920d35a635e123f0af2681626d7c23fcda6`）在 selected audit 階段回報 `WEB_RELEASE_SELECTED_AUDIT_NON_PASS`。實際 artifact 為 `.release-evidence/20261003/web-scope-182bd920/web-install-scope-37084954668/audit.json`，不是建置或正式部署成功收據。

受影響鏈為 `eslint-config-next@16.3.6 → @next/eslint-plugin-next@16.3.6 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`。[官方公告 GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 將 `braces <=3.0.3` 列為 high，尚無 patched version。本次 npm metadata 讀回 braces 最新仍為 3.0.3，Next plugin 16.3.8 與 fast-glob 3.3.3 也仍使用受影響鏈，不能以一般 patch 升級解除阻擋。

這是開發／建置依賴的實際 audit 失敗，不能直接聲稱正式 runtime 已遭利用，也不能以 runtime 排除證據偽稱目前全 Web install gate 通過。不忽略 advisory、不冒用其他套件名稱或更改 audit 成功判定；此輪不建立第三方 ESLint fork。隔離資源建立及正式發布維持待辦，等待有可驗證的依賴修補方案。測試 harness／本機回歸可以完成準備，但不計為遠端 Preview 或 Production 驗收。
