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
