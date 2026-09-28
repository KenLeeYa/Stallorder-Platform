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
