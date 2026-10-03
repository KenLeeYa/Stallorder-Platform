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

這是開發／建置依賴的實際 audit 失敗，不能直接聲稱正式 runtime 已遭利用，也不能以 runtime 排除證據偽稱目前全 Web install gate 通過。測試 harness／本機回歸不計為遠端 Preview 或 Production 驗收。

## 2026-10-03 使用者核准的發布例外

使用者指示「先略過高風險漏洞，先更新正式環境」。本次對已回報的 `GHSA-vfj7-8cjw-p6xm`／`braces@3.0.3` 開發依賴鏈採用明確發布例外；漏洞仍未修復，原始 audit 的非通過結果持續保留。例外須限定公告、版本、依賴鏈與本次鎖定檔，並在發布證據中記錄，不能將其他漏洞或 audit 執行錯誤一併忽略。

其餘必要 CI、資料庫遷移、隔離環境實際流程、精確目標與回復方案、正式部署讀回及受影響流程驗證照常執行。尚未建立隔離資源、尚未發布正式站；治理設定仍 OFF／dry-run。

例外期限為台北時間 2026-10-05 00:00，超過期限不自動延長。例外收據保留 `rootAudit: NON_PASS`，以另一欄記錄核准決策，並綁定當前政策雜湊及 Plan／Apply。此輪 126 項發布例外、目標讀回與隔離設定聚焦測試通過；另有實際合成產物收據回歸通過，均不是遠端發布證據。最新 CI 的測試網址假憑證與隔離 Turnstile 設定識別已修正，正式秘密掃描與正式測試金鑰禁用規則保留。

Production migration 發布流程新增實際 team／project／source／完整 alias 讀回，先確認已核實的健康部署，再以精確部署 ID 回復；候選若在 migration 前改動 Primary 身分或 alias 即阻擋。此回復只涵蓋 Vercel 應用 alias，不聲稱回復資料庫或 Edge Functions。CodeQL 告警判讀另見 `PR366_CODEQL_TRIAGE_20261003.md`，告警未 dismiss、未聲稱全安全通過。

## 2026-10-03 瀏覽器驗證回歸修正

CI `37099582769`（`2a04964b`）在一小時 job 時限被取消，只完成八批中的三批：79 passed、13 failed、1 flaky，第四批與後續尚未完成；不得計為瀏覽器 QA 通過。隔離工作 `37101524470` 在環境核准前取消，沒有建立付費資源。

已定位舊商品管理入口與三欄店員明細操作的測試選取、KDS 重複警示選取、LINE fixture 代碼格式及重新申請 fixture 縣市格式。稽核不可變保護使舊清理交易失敗，因此測試改為保留稽核紀錄與相關 actor、使用本輪識別並避免刪除受稽核外鍵保護的商家／攤位。單攤位案例僅暫停精確本機合成攤位，使用 updatedAt 比對並還原；正式稽核、權限及營業時間規則不放寬。CI 整體時限改為 120 分鐘，保留單 worker、原本單測時限、全部測試及 flaky 失敗判定。

36 項表單契約與清理／執行器／fixture 聚焦測試通過，KDS 警示選取的最小瀏覽器重現通過；仍須最新版本完整 CI、配對 Preview 與正式流程讀回。外送選項測試使用 QR 的合成 session 只驗證元件；實際公開外送入口及營業時間驗收仍由配對 Preview 的真實 session／送單／DB 讀回完成。

## 2026-10-03 同組 Preview 恢復驗證

唯一 manual run `37103994917` 已建立 child `jwscaevupxhaolhfydtv` 和部署 `dpl_BrsgjRg4nnn2wZHXT5s8vCT1427e`，原始部署版本 `0b4e0d8c5967fed5540074c09062017d74370ca7`。173 筆 migration、隔離 pgTAP、DB lint 與 Web 建置已通過；CLI deployment listing 缺 ID 導致 capture／cleanup 失敗，瀏覽器驗收未執行，不計 PASS。

恢復操作僅 `resume-manual-run`＋原 `cleanup_run_id=37103994917`，先原始 artifact owner／provider 身分讀回，再重用現有 pair；不建立、重新 migration 或部署任何新資源。原 runner expiry `2026-10-03T12:47:12.837Z` 不延長，本機監控仍採較早 `12:44:35Z`，六小時／US$1 不變。

新版候選僅調整測試入口、同組恢復及 QA harness；續跑先驗證產品來源／lock 雜湊與全部 Supabase 來源相同，binding 仍以原部署 SHA/tree 產生，明示新 harness 雜湊，不能聲稱兩個完整 tree 相同。最新候選 CI／Web scope 與正式發布 Plan 仍須重新通過。新增會員真 API 撤權（session 保持有效）與 18 項部署 DB 函式跨午夜 rollback 補證；後者不是 live HTTP 真時鐘午夜切換。

## 2026-10-03 失敗原因與第二次有界驗證

原 run `37103994917` 的 Vercel listing 只有 URL，未提供 deployment ID；精確 provider URL 讀回與 owner 核對已修正。重用同組的 run `37105863807` 在 Supply fixture 初始化停止，未執行瀏覽器案例；當時只留下通用錯誤碼，因此 seed 衝突是來源與回歸測試支持的原因，尚非該遠端執行的完整錯誤讀回。seed 已存在 Supply override，舊 fixture 拒絕任何既有 override；修正僅唯讀沿用欄位及 owner 完全相符的 seed，還原核對整筆未變，不覆寫或刪除。其餘未知／停用／過期／漂移設定仍拒絕。

上述 pair 已清理，獨立 Supabase branch list 只剩 parent，精確 Vercel deployment GET 回傳 404；到期監控已停用。CI `37106601858` 的 unit、型別、DB regression 及 DB lint 通過，Production guardrails 拒絕兩段新測試的合成連線字串，已改用既有 synthetic fixture helper，未放寬秘密掃描。上述均非正式發布完成證據。

使用者在「再建立一組、新增 US$1、最長 6 小時、測完立即清理」的核准問題後指示「確認原因後繼續正式環境更新」。此輪按該具體範圍進行第二次驗證：同時最多一組 data-less child 與配對 Preview，另建精確 owner receipt 及到期監控，不沿用已刪除的 run／資源 ID，不自動延長、不建立第三組。最新必要 CI 與實際流程通過後，依既有授權建立新的 Production／DR Plan、Apply 並讀回正式流程。治理仍 OFF／dry-run，真 LINE／Pay 仍不在本次測試啟用範圍。

重建前的完整 fixture 預查另確認：Supply 代碼與單位不符 DB 大寫／UOM 約束、通知類型不在 DB 白名單、seed 未提供行程地點。修正限定測試 helper：合法代碼／`G`、既有合法通知類型加 synthetic metadata、精確 child 的專用地點與 13 筆行程同交易建立並記錄 IDs。測試直接讀取真 migration 約束；80 項聚焦測試由作者與獨立審查者各自通過，Production guardrails 3190 檔案／173 migrations 通過。不修改正式 seed 或放寬資料庫保護，尚無第二組遠端 PASS 收據。

本次首次升級的 Production candidate 明確覆寫 build/runtime `LINE_PLATFORM_ENABLED=false` 與 `LINE_PLATFORM_NOTIFICATIONS_ENABLED=false`，不修改共用設定或 legacy OA。獨立來源檢查確認新 platform order owner／pilot／integration 不由 migration 自動填入，故此次不建立平台通知工作；11 項部署契約測試通過。這不代表未來啟用 OA 後回復舊 worker 已安全：舊 worker 不區分 delivery mode，屆時必須另做工作隔離。Vercel alias 回復仍不會還原 migration、backfill 或 Edge。

## 2026-10-03 完整 CI 37112408500 回歸原因

候選 1f45a32c 的完整八批 E2E 已完成：192 passed、28 failed、1 flaky、78 skipped；整體 FAIL，Production-mode resilience 未執行。lint、型別、unit、173 migrations、pgTAP、DB lint、guardrails、建置通過，不能取代 E2E。第二組付費 Preview 與正式／DR 更新均尚未開始。

失敗證據定位改版後 portal 明細／可見 KDS queue、完整商品管理入口、900px 平板斷點，以及保留稽核 fixture 後多攤位登入與報表 scope。測試沿真實登入 API 指定正常角色 next，保留認證、權限及結果斷言；公開外送改用實際 store 入口，該項 session/menu 仍 mock，真營業時間送單驗證待 Preview。結帳實收欄受 18px 根字級影響變為108px，新增100px上限，不改付款邏輯。

隱私正向案例原先固定 DB55992、origin3093，且要求啟用此輪明確 OFF 的治理能力。OFF profile 應驗證不可用且不洩漏／不寫入，enabled 正向驗證保留為明確選用的隔離 profile，不宣稱此輪已通過。全部改動尚待新 CI；此輪單 worker 隔離 runner 無其他同攤位 writer，本機156-migration手動環境不升級、不重置。

## 2026-10-03 完整 CI 37116981928 剩餘六項

候選 10f5280c 完整 E2E 為217 passed、6 failed、78 skipped，無 flaky；整體仍 FAIL，resilience及 dependency audit尚未執行。隱私 OFF案例通過，不代表 enabled治理已驗證。

六項原因為手機訂單摘要合併文字、外送 slug誤用 code入口及 QR context、QR預覽選錯多攤位預設、商品組合需明確指派、多欄 portal與結帳後明細關閉，以及未儲存 POS的原生放棄確認。修正保留付款、狀態、DB及拒絕邊界斷言，沒有放寬產品權限或營業時間。

新增僅限候選分支手動 `regression-local`，重用 CI的 GitHub runner本機 Supabase及六個完整 spec，不使用 Preview secrets或建立付費 provider資源。精確取消本輪自動 FULL run並確認完成後才執行聚焦測試，之後重新執行同 SHA的 FULL CI；聚焦通過不能取代完整發布 gate。第二組付費 Preview與正式更新仍須最新完整 CI通過。

聚焦 run37120088769 在單元測試階段因既有 workflow契約假設所有 job均為付費 Preview而失敗（4439 passed、2 failed、106 skipped），E2E未執行。修正精確區分無 provider操作的 `regression-local`，其餘 job的核准、環境及清理條件保留。Preview手機 POS使用唯一可見按鈕，避免 responsive重複控制定位。DR入口部署同時明確覆寫 LINE平台與治理為 OFF、刪除 dry-run，與 Primary一致；沒有遠端設定異動。

正式放行須由唯一 writer另行讀回真正 `.github/workflows/ci.yml` 完整 run成功、同一來源／tree，合併後再確認 main push完整 CI；Readiness的 Plan成功或 focused成功均不能取代此證據。正式 sequence為 DR schema Plan／Apply → Primary Plan／Apply（帶同一 DR schema Apply ID）→ replication Plan／Apply（帶同一 Primary Apply ID）→ 既有 DR入口 Plan／Update。每步使用當次 main來源與最新精確 run收據，讀回正式 target及受影響流程；不使用沒有 DR前置 ID的自動 Primary Plan。

## 2026-10-03 完整 CI 37121391558 的三項整批失敗

候選 a9bbfb44 完整八批 E2E 為218 passed、3 failed、78 skipped；整體 FAIL，resilience與 dependency audit未執行。先前18項聚焦成功不足以取代完整suite。第二組付費Preview及正式／DR發布尚未開始。

套餐指派以保留fixture攤位數推定多店，與實際 SINGLE_STALL 模式不符；改讀真organization operatingMode，保留單店active stall與DB指派斷言。商品工具列和KDS設定trace分別顯示catalog editor及設定API回傳429，共用seed owner累積觸及 authenticated-api 300次／5分鐘；改用僅限本機的run-owned OWNER，沿真登入與API、保留全部結果斷言，結束撤銷自身登入權限並保留稽核父資料。沒有重置bucket、放寬限流或改正式權限。修正後須重新取得完整CI與當次配對Preview證據。

完整run37123787205在整批瀏覽器執行前精確取消，runner local Supabase cleanup成功；原因是獨立QA盤點發現本次受影響的供應設定錯誤恢復與persisted改單案例僅在歷史專用lab profile存在。新增標準CI聚焦案例沿正常登入、真API及DB讀回，商品429／500／斷網只注入精確transport以驗證UI輸入與忙碌狀態；改單用run-owned資料驗證成功／重播、付款／製作拒絕與stock trigger交易rollback。未啟用治理、LINE或Native，也未將歷史全部lab升為新gate。這些案例仍待重新執行完整CI，不計為runtime PASS。

完整run37124778164（860b3e0c）226 passed、7 failed、78 skipped，resilience與audit未執行。先前429兩案與新供應錯誤恢復已PASS。套餐case仍碰到5個ACTIVE retained fixture，改以案例限定MULTI_STALL與updatedAt CAS還原，真指派及DBcount保留。6個新改單case在auth/me401停止：trace證實正式Secure auth cookies由Chromium localhost HTTP攜帶，但Playwright APIRequestContext不帶；必須改成真瀏覽器same-origin fetch，不改cookie、認證、CSRF或限流。內容API尚未執行，不計改單驗證通過。聚焦local profile追加新2spec，仍無paid provider步驟且FULL命令不變；聚焦成功後須重新取得同tree完整CI。

Focused run37126898925（4b530aa8）22 passed、3 failed；四項STAFF_POS改單已PASS。兩外送fixture在變更origin時被OFFLINE_ORDER_IDENTITY_IMMUTABLE拒絕，改為初次INSERT設定來源及外送身分，不停用trigger。套餐在明確MULTI_STALL下仍使用舊single-mode count0與switch語義，改為實際checkbox count1/check，原DB指派與CAS還原保留。兩檔獨立審查無confirmed P1/P2，lint/tsc通過；新runtime、完整CI、配對Preview及正式發布仍待驗證。Runner local cleanup成功，無第二組paid資源。

FULL37127826839 attempt2（466328ea）229 passed、3 failed、1 flaky、78 skipped；resilience/audit未執行。剩餘集中reusable-note-navigation四viewport：trace確認catalog/editor HTTP429，authenticated-api以shared owner userID累積300/5min；320另有networkidle等待不穩定。改每viewport獨立同權限owner真登入，僅撤銷自己的session/membership/profile並保留audit；以可見enabled功能入口等待，原focus/search/scroll/overflow四尺寸全部斷言保留，無限流放寬/timeout延長/skip。focused追加該spec而FULL命令不變，独立來源審查PASS、tsc與11項流程契約通過。新runtime與正式發布仍待驗證，第二組付費資源尚未建立。

FULL37131485288 attempt2（eb7ce11c）231 passed、2 failed、78 skipped、無flaky；reusable-note四尺寸已PASS，resilience/audit未執行。QR cache trace真session409 STALL_CLOSED：台北23:40已過seed23:00close，正向case缺固定營業時段。最後case限定loopback postgres與exactseed7hours，transaction CAS暫設24hopen、finally完整applied欄位CAS盡力逐列還原/漂移fail；保留cachedcontent先呈現與disabled submit，再release真session並新增201assert。Theme trace exact目前無法開始點餐提示遮擋，改導航前限定兩種已知alert正常關閉handler，不force、未知alert不忽略。聚焦追加2spec/full不變，獨立審查與lint/typecheck/11contracts通過。新runtime與正式部署仍待，未建立第二組付費資源。
