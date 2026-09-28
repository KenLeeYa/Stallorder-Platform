# LINE v2 隔離 Preview 執行紀錄

2026-09-28，Asia/Taipei。使用者已同意 [資源方案](SETUP_RUNBOOK.md#2026-09-28-公開測試資源方案尚未執行)：草稿 PR、單一 data-less Micro branch＋既有 Vercel Pro Preview、最長24小時、新增費用管理預算US$2；OA／Pay測試憑證可限定存於本repo GitHub Preview Secrets、測試branch Vault及Preview server runtime，到期清理本次雲端資源，保留本機。此同意不包含merge、Production或真實收退款。

## 起始讀回

- Repo `KenLeeYa/Stallorder-Platform`；分支 `codex/line-platform-oa-v2-20260927`，起始HEAD `a0ee05d`，相對 `origin/staging` 0 behind／13 ahead，317 files，包含先前UI/v1/v2候選；tracked clean，既有未追蹤QA artifacts保留。
- Primary project `prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP`，team `team_MMfsiG94K9Zy3e6w7Ccc9xY4`；原部署 `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`，commit `5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`，production READY。
- 07:17台北：`/login`、`/staff/login`、`/store/viet-food-yc`皆HTTP200；匿名health401；`/api/availability/config`回 `NORMAL_PRIMARY`／`PRIMARY`／`EDGE_PRIMARY`，QR及Staff AVAILABLE。未做正式建單，不能稱正式全流程驗收。
- GitHub當時無進行中的StallOrder workflow；本次root為遠端操作人。原Primary artifact保留，測試失敗以清理精確Preview為回復方式，不切正式aliases或DB。
- Supabase parent `eyuctbnlvnbnivwasvqr`，已核對Pro組織；Vercel保護為 `all_except_custom_domains`，不全域關閉。公開LINE圖片需後續exact Preview hostname exception及獨立讀回。

## 推送前補強及驗證

1. `99b1f9d` 已把不支援的Nano改Micro，30項workflow契約通過。
2. 為目前LINE候選停用一般Git自動部署；僅讓有data-less DB配對的workflow部署，保留其他分支規則。
3. Preview明確載入、遮罩並注入child分支的Supabase service role／PRIMARY URL與key，避免runtime繼承共用Preview憑證。缺child key就停止，不回退parent。
4. LINE候選清空部署內繼承的OpenAI／Azure key、停翻譯及真LINE旗標；先跑合成QA，後续真provider設定另記錄。對該分支不執行無關的付費翻譯smoke。
5. 先以兩項契約失敗重現上述缺口，補強後31項workflow契約全數通過；不是雲端執行結果。
6. Gitleaks掃描待推送commit範圍：兩筆均逐一核對為測試UUID idempotency key、明示synthetic callback key，不是真實憑證。沒有新增全域忽略规则；掃描原始結果留本機artifacts。

## 雲端建立與第一輪結果

- 草稿 [PR #365](https://github.com/KenLeeYa/Stallorder-Platform/pull/365)，base staging；未合併。
- 候選 `b361d731542ec180876f03b1e47a1b5349169649`；Preview run `36358520474` 已完成 migrations、seed、migration history，資料庫測試執行中，尚無部署 URL。
- Supabase branch `pr-365-oauth-delivery`，ID `adf5e447-c919-4594-91bf-1cce2394d613`，child ref `gfoscoqwumwdtvkbfoiv`，已確認非 parent、data-less、Micro。建立時間 2026-09-28 07:24:03 台北。
- `line-preview-24` heartbeat 每小時檢查；09-29 06:24 台北起清理，最遲07:24到期。資源ID及後續變更保留於本機 `artifacts/line-v2-preview-resources.json`；不得延長或清理其他 branch。
- 首輪CI `36358520438` 被 UI audit 擋下：11項缺少 button/input type 與 QR textarea 長度。明確指定 action/submit 語意、文字輸入型別及61字QR上限後，366個TSX檢查與typecheck通過；待推送後雲端重驗。
- CodeQL `36358520451` 成功。此為靜態安全掃描，不是真LINE／付款證据。
- 測試DB設定已存於受限本機private目錄，ACL僅MSI\KY與SYSTEM；OA／Pay尚未匯入雲端，MINI Endpoint／OA Webhook未改。


## 雲端 gate 增量（07:46 台北）

- `b361d73` 的 Preview `36358520474`：72個SQL檔／1,619項 pgTAP PASS，728秒；schema lint無錯誤。為執行新UI修正 `c7fbb6f`，推送後自動取消尚未完成的建置／部署步驟，因此整個run為CANCELLED，不能稱Preview部署成功。
- `c7fbb6f` 的CI `36359425292`：lint、UI audit、typecheck通過，3,541 unit PASS／97 SKIP，但Rich Menu使用node:test，被Vitest判定無suite而FAIL。以相同命令本機重現，將該檔改用既有Vitest及onTestFinished cleanup後，原12案例全部PASS，未刪除斷言／跳過套件。
- 新一輪Preview `36359425297`仍使用原child branch，資料庫測試執行中。無新增資料庫。
- 07:34台北Primary再次讀回：原deployment／commit、PRIMARY及EDGE_PRIMARY不變，QR/Staff AVAILABLE。
- 尚需在Chrome完成Vercel既有帳號2FA以操作exact-domain exception；未修改保護設定。測試runtime獨立secret已先準備於同一受限private目錄，ACL僅MSI\KY與SYSTEM；Push/Pay/平台入口仍關閉，尚未送到雲端。

## Rich Menu 測試執行器修正

- 原因：CI 的 Vitest 掃描 `.test.mjs`，但該檔以 `node:test` 註冊案例，造成 `No test suite found`。改為既有 Vitest 的 `test`／`onTestFinished`，保留12項案例及全部斷言。
- 07:46–07:48台北，本機完整 `npm test -- --reporter=dot`：591檔／3,553項 PASS，12檔／97項 SKIP，exit 0，123.09秒。收據 `artifacts/line-v2-preview-full-unit.log`；SKIP不算通過，外部LINE／付款驗證仍未完成。
- `c7fbb6f` 的 CodeQL `36359425295` SUCCESS。修正推送後仍需新HEAD雲端CI及配對Preview結果。

## 範例設定與憑證掃描（08:03 台北）

- `6be05f8` CI `36360109446`：unit、DB tests／lint通過，Production guardrails在`.env.example`的`PICKUP_TOKEN_GRACE_MINUTES="120"`失敗，原因是欄位名稱含TOKEN而被視為憑證。
- 本機`npm run production:check`同樣重現。該欄位是選填時長，runtime本來就預設120分鐘，因此改為註解式範例，保留預設說明；未放寬憑證掃描，也未修改取餐期限行為。
- 此次失敗後build及E2E未執行，不能算通過；修正後重新走同一gate。

## 配對 Preview 與導覽回歸（08:24 台北起）

- `5e005cd` 的配對 Preview `36360718506` SUCCESS：72 SQL／1,619 pgTAP PASS、DB lint、Edge Functions、build、read-only smoke 與合成 OAuth／delivery smoke 通過。部署 `dpl_KgQRubycYquDMesVYXpLUBgmeqA8` READY，URL `https://stallorder-platform-dantho33d-ada76145-8663s-projects.vercel.app`，仍受 Vercel 登入保護。
- 此 artifact 使用 GitHub PR merge tree `b2ba1452f4ac9130b0f6b7561444dbeef493ac63`，parents 為 staging `3ec6e9c1f2aa1291ed4b57f10d51a47bafedc079` 與候選 `5e005cd7c09be3bc3ab7c93935c45a2737b4795c`；PR 未合併。此部署沒有 alias，不推定存在分支網址。
- CI `36360718526` 在 E2E shard 2 失敗：shard 1 的35項、shard 2 的27項通過；2項失敗、5項未執行，其餘 shards 未執行。原因是帳務開關已收進「系統設定」、手機庫存／成長入口已收進「所有功能」，舊案例仍直接搜尋收合內容。
- 修正測試操作順序，保留 checked 狀態斷言，增加展開狀態及手機功能目錄實際點擊、到達正確頁面與關閉對話框的斷言。手機登入明確指定授權商家的 next 路徑，兼容多商家測試帳號。
- 本機聚焦2項 PASS（49.5秒），lint／typecheck PASS；完整帳務回歸與新 HEAD 雲端 CI 另記結果，尚不能稱完整 E2E 通過。
- 08:24 Primary readback 仍為原 deployment／commit，`NORMAL_PRIMARY`、`PRIMARY`、`EDGE_PRIMARY`，QR／Staff AVAILABLE。未做正式建單或 LINE／Pay 外部寫入。
- Vercel browser 仍等待使用者六位數2FA；沒有修改 deployment protection。真 LINE runtime、OA Vault、MINI endpoint、Webhook、Pay 與實機驗收未啟用。
- 完整帳務及手機導覽：本機3024＋獨立clone、明確使用Circuit B，7項流程斷言PASS（2.3分鐘），包含方案申請／人工付款／停權與恢復／加購／手機版。之前兩輪本機完整驗證分別因dev解析错误及未啟動Edge服務失敗，保留`artifacts/line-v2-preview-e2e-regression*.log`，未計為PASS。
- 最後一輪dev仍留下JSON解析／串流錯誤與React警告，不能稱無錯誤驗收；目前僅確認流程斷言通過，待正式建置模式CI確認。此次未啟動Docker容器；Playwright管理的3024／55431測試服務結束即停止，原3023及共用55722保留供人工QA。

## Vercel 登入與第三組 E2E 修正（09:07 台北）

- 使用者完成 Vercel 2FA；Chrome 已實際到達本團隊的 StallOrder Deployment Protection 頁，Require Log In 仍開啟，沒有新增公開例外。
- `1c3e0d2` 的配對 Preview `36362844819` SUCCESS；部署 `dpl_6owziSCTAxbo88reEVFHDAXQfACs`，merge tree `af8b67533c2d2ae0d68b793a50db0e86d843cd61`，parents 為原 staging 與 `1c3e0d2`，仍無 alias。
- CI `36362844718` FAIL：E2E 前兩組35＋34項通過，第三組22項通過、1項失敗、3項未執行；後續組與 production-mode smoke 未執行。失敗定位到 `page.getByRole("status")` 同時符合網路狀態及商品設定成功訊息，不是儲存 API 失敗。
- 商品設定及使用同一成功對話框的預約／抽獎設定，改由 dialog 內的 status 檢查，保留完整文字斷言。多攤位測試登入明確指定受測組織，測試組織清理先刪除其測試攤位，再刪組織，保留預設工作站保護規則。
- 本機多攤位回歸目前不算通過：補齊 CI 的模擬 OAuth fixture 後，登入建攤案例通過，批次分派收到400；clone 內已有235個保留的攤位，與乾淨 CI fixture 不同。原 OAuth overrides 已還原，未清除既有範例資料；完整驗證交由新 HEAD 的乾淨 CI 重跑。
- 08:52 Primary provider/readback 仍為原 deployment／commit、NORMAL_PRIMARY／PRIMARY／EDGE_PRIMARY。真 LINE runtime、Vault、Endpoint、Webhook、Pay 及公開例外尚未啟用；本機已準備 deployment guard script，但尚未執行遠端部署。

## 手機工具列與單一商家模式回歸（09:43 台北）

- `a9e3260` 配對 Preview `36364641423` SUCCESS：72 SQL／1,619 pgTAP、22項 read-only smoke 及合成 OAuth／delivery 通過。第三個部署 `dpl_9CzrZFnBf9SVjiH4uBRSoGFD9ci3`，merge tree `dab8b22271e51679b4598db238514faf26c026da`，尚無 alias。
- 完整 CI `36364641379` FAIL：前3組35＋34＋26項 PASS／11 SKIP；第4組33 PASS、3 FAIL、1 FLAKY，其餘未執行。CI 的 E2E 已使用 `next start` 正式建置模式；獨立 resilience smoke 因前一步失敗未執行。
- 離線裝置及跨角色手機流程仍直接操作收進「所有功能」的按鈕；修正為點開手機工具列並確認展開。純店員登出案例原本以即時 `isVisible()` 決定是否展開，可能在頁面未就緒時跳過；改為等待按鈕可見及啟用。
- 工作模式案例把多組織才有的商家名稱後綴写死。保留確切店名、允許單／多組織兩種標籤，並加強切換後 URL 必須是指定 `aming-chicken` 廚房。另將受測帳號的登入 next 明確指向既有測試組織／攤位。
- 隔離本機正式建置模式的店員／廚房權限、登出及 Storage 禁用時的模式切換：2 PASS（33.1秒）；lint／typecheck PASS。離線完整流程及 QR 跨角色流程待乾淨 CI 的 Storage／Edge 服務驗證，本機未為此啟動其他 Docker 容器。
- 09:43 Primary provider 回讀仍為原 deployment／commit／保護設定；availability 仍為 NORMAL_PRIMARY／PRIMARY／EDGE_PRIMARY，QR／Staff AVAILABLE。3024及55431已停止，原3023人工測試與共用55722保留。
- 尚未匯入 OA Vault、修改 MINI endpoint／Webhook／公開例外，亦未發送真實 LINE 訊息或建立 Pay Sandbox 交易。24小時到期時程不變。

## 相鄰工具列回歸與完整失敗收集（10:00 台北）

- 相鄰 POS 案例在本機重現兩個過時斷言：以 `display: contents` 的外層容器量測按鈕列，及要求收合後的手機主要工具列一定水平溢出。改量測可见按鈕／連結的中心線及相互重疊，手機分別驗證收合時不溢出、展開所有功能後可水平捲動；同樣的平板 KDS 容器量測一併修正。
- 桌面完整點餐版面案例 PASS（16.6秒）。手機流程已通過工具列、建單201、收款與班次關聯，最後列印斷言 FAIL：保留的本機 clone 回傳 CANCELLED 而非 PENDING；該斷言沒有放寬，待乾淨 CI fixture 核對，不稱完整手機收款／列印通過。
- 既有 E2E runner 在首個失敗分組直接退出，後續測不到。新增聚焦回歸先重現提早退出，再改為完成所有分組並彙整失敗；任一非0／異常終止仍以非0退出，spawn錯誤仍立即拋出。4項 runner 測試 PASS、lint／typecheck PASS。
- 每組保留獨立 trace/report，CI失敗時保存1天的隔離 fixture E2E 證據，後續不必靠推測排查。未放寬 flaky／skip／部署 gate。
- `b22e23b` 的完整 CI／配對 Preview 尚在執行，後續推送可能使其取消，不能計為完成。最新候選及全部實際部署仍以 `artifacts/line-v2-preview-resources.json` 讀回記錄。
- Vercel team 用量頁本期基礎設施 US$4.94／包含額度US$20，全数由額度抵扣，其中全團隊 Build CPU 顯示US$0.22；這不是本PR單獨用量，頁面可延遲1小時。沒有加購方案；本次Micro的24小時基本運算估計仍約US$0.32，清理時程不延長。
- child 排程唯讀核對：目前 Vault 及 notification integrations 皆空，既有排程未設定外部發送目的地。OA／Pay live測試尚未開始。

## 八組完整結果與 MINI 初始設定測試（10:36 台北）

- `791ec82` 配對 Preview `36368127813` SUCCESS：72 SQL／1,619 pgTAP、22 read-only checks、合成 OAuth／delivery 通過。部署 `dpl_7EuWg1VF1UipNAQrNQt6BMwdZb5Q` READY，merge tree `9d9b8297a2b995b6bae933e4fe09ab7d108f58a1` 的 parents 為原 staging 與 `791ec82`；沒有 alias 或公開例外。
- 完整 CI `36368127787` 已跑完8組：199 PASS、2 FAIL、72 SKIP，無 flaky。前7組無失敗；先前手機工具列、模式切換、跨角色訂單，以及手機 POS 收款／列印與失敗重印後結單案例均通過。SKIP主要是另需顯式本機 QA 模式的案例，不計入PASS。獨立 resilience smoke 及 dependency audit 因 E2E 失敗尚未執行。
- 最後2項同在 `line-miniapp-setup.spec.ts`，在進入頁面前被3024及本機旗標硬編碼的 guard擋下。本機6秒重現相同失敗。改用 Playwright 配置中的明確 HTTP loopback 位址限制；不允許遠端站點，也不跳過案例。未設定頁保留外部請求、登入迴圈、cache/referrer/CSP斷言。
- 商戶回歸改走現有帳密表單，固定授權組織，驗證登入成功、MINI challenge 503/no-store、瀏覽器 Session及重新整理後受保護頁。快速登入另有既有本機 readiness案例；未為CI開啟快速登入。瀏覽器請求保留production Secure cookie；APIRequestContext在HTTP loopback的401不作Session失效結論。Dashboard自動加入日期／攤位篩選，URL斷言核對origin/path/組織而不禁止正常篩選參數。
- 聚焦2項最終 PASS（7.9秒）；中途401及過度嚴格query斷言失敗各自保留於artifacts，未刪除證據。沒有改應用功能或Production。新HEAD仍需完整CI與配對Preview。
- 10:20 Primary讀回：原deployment／commit不變，NORMAL_PRIMARY／PRIMARY／EDGE_PRIMARY，QR／Staff AVAILABLE。3024與55431測試程序退出；3023人工QA及共用DB保留。
- 已保存MINI三環境原始Endpoint（LINE預設頁）；OA API讀回404 `Webhook endpoint not found`，啟用狀態仍須控制台讀回。沒有寫入OA Vault、Endpoint、Webhook、Push或Pay；期限仍為09-29 06:24起清理、最晚07:24完成。

## 完整 CI 通過與受保護 runtime 準備（11:10 台北）

- 候選 `d85b881d2537ee1c13ba976ec37b8a78b2b8d517`：CI `36370505127` SUCCESS，3,557 unit PASS／97 SKIP；8組 E2E 合計201 PASS／72 SKIP／0 FAIL／0 FLAKY；獨立 production-mode resilience 8 PASS；dependency audit 0 vulnerabilities。CodeQL `36370505143` SUCCESS。條件式 SKIP 不算通過，真 LINE／付款／實機仍待驗。
- 配對 Preview `36370505130` SUCCESS，72 SQL／1,619 pgTAP PASS；read-only smoke 實際20 PASS／2 SKIP（報表把跳過的 root/WWW 與 Production QR 也列入22/22，本收據不沿用該通過數）。合成 OAuth／delivery PASS。merge tree `d143e08eb0cb869fd2dbe38a59e0652bb9625220` 的兩個 parents 為原 staging 與本候選。第五個部署 `dpl_3fCZYn8M6KPGx1Hqwpx4UYvdhnn4`。
- 11:01 Primary：原 deployment／commit／backend不變；login、staff/login、公開越好吃菜單HTTP200，匿名health401。沒有正式建單。
- 測試fixture初始化曾因 QR `(stall_id, token_version)` 重複而失敗，兩次交易均回復。一次性準備腳本改取該店下一版號後成功；4個seed帳號改用private檔案中的獨立密碼、停用合成Google身份、撤銷舊Session。讀回A／B兩店、6個啟用測試商品、A QR版本2與B版本1。沒有修改应用程式或重跑CI seeding。
- 固定別名 `stallorder-line-v2-pr365-20260928.vercel.app` 原GET404；獨立alias Plan／SHA256及讀回保存在artifacts。建立後匿名 `/mini` 302至Vercel SSO，仍受登入保護；Primary與共用保護設定不變。清理須先核對alias仍指向manifest記錄的本次部署，再移除，不能動其他aliases。
- OA控制台原狀讀回：Webhook關閉且disabled；聊天關閉，歡迎訊息及自動回應開啟，均未改。OA Secret／Token已依授權存入child Vault（參照manifest的兩個UUID），以官方bot/info確認平台OA身份；integration已建。MINI Endpoint／Webhook未改，Push／Pay仍關閉。
- 第六個部署 `dpl_GwSQtmv5VZFhNEZGG7EmxCYbNu98`，URL `https://stallorder-platform-ej9wfpgop-ada76145-8663s-projects.vercel.app`，同一merge tree，server/build只注入本次47個明確設定。metadata為 `stallorderPreviewResource=pr-365`、runtime `line-v2-live-disabled-push-pay`；目前BUILDING，尚未改alias到此runtime，不能稱可實機驗收。
- 設定後不可直接重跑會重置fixture的paired Preview workflow；若需新候選，先收回公開入口／停測並重新封存測試帳號。24小時期限維持09-29 06:24起清理、最晚07:24完成，不延長。

## 受保護 Preview 實際登入與權限驗證（11:25 台北）

- 第六個部署已 READY；固定別名已由第五個部署切到 `dpl_GwSQtmv5VZFhNEZGG7EmxCYbNu98`，來源仍為已通過 CI 的 merge tree `d143e08eb0cb869fd2dbe38a59e0652bb9625220`。匿名 `/mini` 與 `/login` 仍會導向 Vercel 登入，沒有公開例外。
- Chrome 由登入表單使用隔離 owner 帳號，已實際進入 A 店的商家儀表板；證據 `artifacts/line-v2-preview-owner-dashboard.png`。這是商家帳密登入，不是真實 LINE 顧客登入。
- 部署後 HTTP QA 15 項 PASS：A/B 菜單、匿名401、商家平台管理 API 拒絕、平台管理者讀回、MINI challenge/cache/referrer、跨來源拒絕、Webhook 簽章與12個前端 JS 不含受測 server 機密值。測試使用既有 automation bypass header 連入此精確 Preview，不新增 bypass credential；正式站未建單。
- 首輪 helper 將商家拒絕錯寫為403；實際授權程式刻意回404及「找不到指定資源。」。保留失敗收據 `line-v2-preview-runtime-qa-before.json`，修正 helper 為精確404及錯誤文字後重驗15項通過，未放寬應用權限、未改 app code。最終收據 `artifacts/line-v2-preview-runtime-qa.json`。
- Preview 菜單約3.7–3.8秒、密碼登入約4.8–6.0秒；瀏覽器冷載入曾出現網路品質提醒。這是本次隔離站觀測，不能當作正式效能數字或流暢性驗收。
- 11:24 Primary provider/readback：原 deployment／commit、`NORMAL_PRIMARY`／`PRIMARY`／`EDGE_PRIMARY` 不變；login、staff/login、公開菜單200，匿名health401。仍沒有正式核心建單實測，不能稱正式全流程通過。
- 已填妥唯一公開例外 `stallorder-line-v2-pr365-20260928.vercel.app`，尚未點 Continue；瀏覽器規則要求降低存取保護時取得當下確認，已集中詢問使用者。待確認畫面 `artifacts/line-v2-preview-exception-confirmation.png`。MINI三環境Endpoint、OA Webhook及其開關均未變更，Push／Pay仍關閉；真LINE、Sandbox交易、實機掃碼及正式啟用仍未完成。
- 此處只有本機收據更新，未推送候選，不觸發會重置 child fixture 的 CI workflow。cleanup automation 保持 ACTIVE，時程不延長。

## 單一網址公開與 LINE 官方驗證（12:15 台北）

- 使用者明確回覆「確認公開單一測試網址，繼續後續測試」，依此只新增 `stallorder-line-v2-pr365-20260928.vercel.app` 公開例外。UI清單及匿名HTTP讀回：`/mini` 200、平台管理API401；部署原始網址仍302到Vercel。專案保護仍 `all_except_custom_domains`，Primary deployment與commit未變。
- Developing `2011762558` Endpoint 已設為公開別名 `/mini`，Review／Published仍為原LINE預設網址。平台 OA `@028sijlm` Webhook 已設定 `/api/webhooks/line-platform` 並開啟；聊天／歡迎／自動回應設定不變。這些設定已記入manifest，清理須比對基準後還原。
- LINE官方Webhook驗證首輪 `REQUEST_TIMEOUT`；後續3次中2次成功、1次逾時。相同空事件的直接簽章請求約1.7–2.4秒，沒有假造好友事件或發送訊息。讀回runtime在東京 `hnd1`、child資料庫pooler在新加坡。
- 同一已通過CI的merge tree及47項runtime設定，以deployment單獨覆寫 `sin1` 做比較；未改app code、專案預設region或正式站。新部署 `dpl_HSsXwrQueF7UB31azRMNYqE9nXiK`／`stallorder-platform-s9rqz89nc-ada76145-8663s-projects.vercel.app`，metadata `pr-365`，已加入清理manifest。暖機後東京1794/1752ms、新加坡589/454ms；冷啟動新加坡1631ms。固定別名已切到新部署，公開例外保留。
- 切換後官方驗證 **5/5 success=true／HTTP200**，約598–1028ms（含呼叫LINE驗證API往返）；公開alias、不帶Vercel bypass的15項QA全數PASS。菜單334–589ms、登入620–1042ms、直接空Webhook188ms，皆屬當次Preview觀測，不外推正式環境或保證所有冷啟動。收據 `line-v2-region-comparison.json`、`line-v2-webhook-official-verify-sin1.json`、`line-v2-preview-public-qa.json`。
- child Vault 新增精確worker URL／CRON_SECRET兩筆，沿用原通知排程，另新增job12 `stallorder-preview-365-line-pay-recovery`。匿名兩個worker API皆401、授權皆200／processed0，pg_net最近6次皆200／未逾時。清理前須先停止本次writer／通知及job12，保留本機資料。
- A店已建立獨立SANDBOX Connection `30161f39-a405-4567-ac06-487f0b6e0f5d`，引用既有版本化Preview憑證；B店沒有第二個Sandbox商家，維持現金。Push／Pay旗標仍false，沒有Request、Confirm、Refund或真LINE訂單訊息。
- 已請使用者用 `https://miniapp.line.me/2011762558-AZbWkGcb` 完成真LINE登入、本人會員／通知同意與加入平台好友；12:15讀回會員0／事件0。等待此本人操作，不能以控制台管理者ID或合成Session替代真實顧客。實機、Sandbox與正式仍未驗收。到期清理時程不變。

## 真實身分操作待續與正式站讀回（12:23 台北）

- Chrome 已從公開 MINI 登入按鈕到達 LINE 的個人資料授權頁，尚未代按「許可」或接受平台會員條款；頁面保留供本人操作。child 仍為會員0、平台 Webhook事件0、好友紀錄0。此為真實登入流程的中間狀態，不能列為登入通過。
- 待驗邊界：LINE 授權頁顯示既有好友，但加入時點早於 Webhook 啟用。現行程式僅由已簽章 follow/unfollow 事件建立好友狀態，登入僅交換 ID token，會員頁沒有官方好友狀態重查。因此「先加好友、後啟用 Webhook」可能維持 UNKNOWN 並抑制通知。須於本人登入後重現，必要時補官方身分綁定的好友查核；不可直接將 DB 標成好友或偽造 follow 事件，也不可把此案例算通過。
- 最新 provider 讀回：公開 alias 指向 `dpl_HSsXwrQueF7UB31azRMNYqE9nXiK`，`sin1`、同一來源 tree、READY；Primary 仍 `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`／`5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`。正式 login、staff/login、公開菜單200，標準化 `/api/health` 匿名401；availability 為 NORMAL_PRIMARY／PRIMARY／EDGE_PRIMARY，QR及Staff AVAILABLE。未做正式建單。
- 最近5分鐘 child worker HTTP 結果11筆200、沒有 timeout。讀回收據 `artifacts/line-v2-preview-final-live-readback.json`。初版唯讀 helper 誤用不存在的事件表名，核對來源改為既有 `line_webhook_events` 後成功；這是診斷 helper 錯誤，沒有修改 schema 或應用。
- 本階段未再新增部署或啟動本機服務；7個 Preview 部署及唯一 alias／公開例外、LINE Developing Endpoint／Webhook、worker Vault／job12均已納入到期清理 manifest。Push與Pay仍false；等本人授權後才繼續真通知、Sandbox與掃碼驗收。

## 既有好友同步修正（12:50 台北）

- 使用者回覆已登入及同意通知。真 Chrome 從公開 MINI → LINE 登入 → callback → 平台會員頁，確認會員已建立且通知同意已勾選。child 讀回1位會員、0個follow事件，會員頁仍顯示「尚未確認好友狀態」；截圖 `line-v2-real-member-friendship-before.png`。此為真實重現，不偽造 follow 或直接改好友狀態。
- 新增 Session/CSRF 保護的同源 POST；伺服器向官方驗證 LIFF token Channel／期限／profile scope，再比對官方 profile 與目前會員身分，最後讀取 friendship API。UI自動查核 UNKNOWN，並保留重試。只儲存 VERIFIED_API 狀態；Token不保存、不輸出；授權撤銷及较新簽章封鎖優先。
- 聚焦17項（11 provider／4 API／2 LIFF）通過，完整10組本機 LINE／付款資料庫測試89項PASS，包括查核期間unfollow及撤銷身份。typecheck、targeted lint、367個TSX控制項audit通過。新版本完整CI、公開介面與真通知仍待驗，未稱完成。
- 公開child已有真實測試會員，因此後續候選不得執行原paired workflow的重設seed。新增僅適用PR365＋精確分支＋`line-preview-live`標籤的暫時防重填條件；其他PR、CI、CodeQL及closed cleanup保持原行為。先核對遠端沒有active workflow，再加標籤，才推送；fresh CI必須通過。該次paired workflow若被跳過，明記SKIP，不列PASS；schema不變、既有72 SQL／1,619 pgTAP證據僅適用未變schema；新程式以本機DB與保留資料的實际Preview驗收補足。此取代11:10需要收回入口重建fixture的建議，避免打斷已同意的實機會員。
- 精確標籤列入清理收據，測試期間不可移除後再推送；到期先停止writer及排程、清理雲端資源，最後處理標籤。本機3023與共用55722沿用，未新增Docker；Push／Pay仍關閉，24小時期限不變。
- 補充：全套本機單元測試3,573 PASS／98 SKIP；明確啟用的本機DB 89 PASS另列。12:51 Primary deployment／backend不變、登入／公開菜單200，匿名health401。遠端無active workflow；PR365精確保護標籤已建立並讀回，已加入cleanup manifest。

## 真會員、測試啟用與送單返回修正（13:48 台北）

- `9ac47b9` CI `36379511767` SUCCESS：3,573 unit PASS／98 SKIP、201 E2E PASS／72 SKIP、8 production-resilience PASS；CodeQL SUCCESS。paired workflow 因保留真實會員而 SKIP，不算通過。未變 schema 沿用已有72 SQL／1,619 pgTAP證據。
- 單一公開 alias 更新為 `dpl_EQfj2fzij4qQg4WMWcKHgVT6UFPN`／sin1／來源9ac47b9，metadata pr-365。只有本次 Preview runtime 啟用Push與Pay SANDBOX，raw deployment仍受SSO保護。受保護候選6項及公開15項QA PASS，12個前端assets未含server私密值；第8個deployment已列入manifest，不延長到期。
- 真 Chrome 會員頁重新查核後顯示「已確認好友狀態」，child为1會員／1同意／FRIEND、來源VERIFIED_API。截圖 `line-v2-real-member-friendship-after.png`。没有偽造follow或改DB好友值。
- 真會員在A店送出合成餐點$30，建立 `260928-006`。原送單網址進入舊追蹤頁顯示資料不正確，但本人「我的訂單」可以讀取正確明細。修正為原URL經完整owner比對後導向私有MINI明細，不放寬訪客或他人訂單權限。單元先紅後綠4項PASS；production-mode瀏覽器3項PASS（會員同意、好友故障重試、原URL導頁/私有PNG/他人404），build PASS。
- 該筆單等待修正超過接單期限，13:46由正常店員API接單回409，讀回EXPIRED／UNPAID；保留作逾期案例，不以DB回改。此時無通知job及Pay交易；後續需另建有效訂單接單驗真訊息。
- 本機其他合成瀏覽器範圍：production模式8 PASS／1 FAIL／1 NOT_RUN，失敗為測試環境缺Public Edge key而不能走原訪客購物車；dev補測遇Next chunk/manifest錯誤，沒有改標全通過。私有PNG初次404是本機缺AUDIT_IP_HASH_SECRET，補測試設定後成功，公開Preview已具有該secret。暫存舊.next置於artifacts造成tsconfig掃入失效validator，已保留移至使用者Temp並乾淨build通過，不改應用tsconfig。
- 13:45 Primary仍 `dpl_Cx8GfP12KuFHcCgtnZ7SXxzt4AYZ`／5cc15c6，NORMAL_PRIMARY／PRIMARY／EDGE_PRIMARY；login、staff/login、公開菜單200，匿名health401。沒有正式建單或其他遠端writer。本機3023/shared55722保留；3024僅本輪合成QA，完成即停。

## 第一張真卡片與 Sandbox Request（14:00 台北）

- Chrome本人重新建立 `260928-007`（合成$30、不製作），正常店員API立即接單200。`ORDER_RECEIPT_AVAILABLE` job由原worker首次發送，結果SENT／PROVIDER_ACCEPTED／attempt1，未重送。已請本人回覆手機LINE送達與內容；API接受不當作裝置收到。
- 同筆單從本人MINI詳情點「前往 LINE Pay Sandbox」，原店DIRECT／SANDBOX connection成功Request，交易 `480ef5da-03e2-4d33-9ef6-ebd20bb455bb` 為REQUIRES_CUSTOMER_ACTION，TWD30。Chrome官方 `sandbox-web-pay.line.me` Simulation掃碼頁留給本人，未代填LINE帳密、未真實扣款，也尚未Confirm／退款。
- 店員開始製作先被PRODUCTION_NOT_DUE拒絕，按原API確認顧客要求的取餐時間後開始成功，逐品項PREPARING→READY成功。此步造成原收據QR以SCHEDULE_CHANGED作廢，READY job被PICKUP_CREDENTIAL_UNAVAILABLE抑制。已在本機實際DB worker重現同樣失敗，修正僅對「未過期＋時間變更撤銷＋新時段已確認」同步發唯一新版，舊碼仍拒絕。原手動撤銷／未確認／過期／核銷邊界保留，33項pickup/notification資料庫測試PASS。既有抑制job待新Preview部署後用正式補發API恢復，不能直接改job或假稱已發。
- 導頁候選570c2b9的CI `36383540543` 因guest-claim測試把所有SQL均stub為同一筆eligible order而誤命中owner查詢：3,571 PASS／4 FAIL／98 SKIP。修正fixture按SQL責任回應、保留proof斷言後，兩檔9 PASS、完整本機3,575 PASS／98 SKIP。此CI失敗不視為完成，須新HEAD全套CI；9ac公開站仍在原先通過版本。
- 3024測試服務已停止並讀回無listener；3023 PID49312及shared55722保留。未新增Docker或延長雲端資源期限。
