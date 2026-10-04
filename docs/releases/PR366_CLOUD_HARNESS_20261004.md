# PR366 雲端 harness 驗證（2026-10-04）

狀態：本地隔離候選，未 push、merge 或部署。配對重用已補齊離線狀態機、mock provider contract及同主機跨程序持久化鎖，未接入 live workflow；本文件不是付費資源、保留模式或新憑證授權。

## 來源與工作區

- 遠端 PR366：draft/open，head `89bb30e58c69597531e30d90cc5fba7eeb1607a9`，base `staging`。CI `37150150165` 的 E2E step failure；後續 focused/resilience/audit skipped，不能沿用舊版 PASS。
- 原工作區 `/workspace/Stallorder-Platform`：`work`、`5cc15c6a6189cfd56e127676bc5228e9ffd2ff56`、原本 clean，未修改。
- 本次 worktree `/workspace/pr366-cloud`，分支 `codex/pr366-cloud-harness-20261004`，從精確 PR head 建立；變更保留本地，沒有 upstream/push。
- `.codegraph` 不存在，採來源層檢查。沒有其他實作 writer。
- 新雲端執行工作區，未向舊 PR 分享對話注入指示。

## 雲端能力與空間

Node 24.19.0、npm 11.9.0（manifest 宣告 npm 11.16.0，此差異保留）、Docker Engine 28.4.0、Supabase CLI 2.109.1。4 CPU quota、16 GiB memory limit。初始 overlay 32 GB，約30 GB可用；既有 node_modules 約1.4 GB、12 Docker images 共4.614 GB，沒有容器或 volume。

PR 鎖檔與舊依賴不同，因此本次獨立 `npm ci --ignore-scripts --cache /workspace/.npm-cache`（1199 packages），接著執行 `prisma generate`。實際 Next 16.3.6、Playwright 1.61.1；Chromium 放在 `/workspace/pr366-browsers`（約646 MB），沒有安裝 WebKit。原工作區依賴保持原狀。

Supabase CLI 預設 `/home/agent/.supabase` 為唯讀，使用 `SUPABASE_HOME=/workspace/pr366-supabase-home` 後 version/help 成功。沒有改寫 HOME 或讀取已保存雲端憑證。

嘗試使用獨立 `/workspace/pr366-db`、project `stallorder-pr366-cloud-20261004` 啟動完整本機 stack；ports 54320–54324、54327、8083 原本無 listener。從候選 symlink migrations/seed/functions/tests，未變更 tracked Supabase 設定。拉取缺少的 `supabase/postgres:17.6.1.143` 時，暫存解壓使可用空間降至4.6 GB，停止啟動後瞬間最低2.2 GB；launcher exit143，Docker 自行撤回暫存後恢復約26 GB。沒有建立容器／volume，沒有 migration/seed/reset 成功執行。不重試此大型拉取，不做 prune／刪除既有 images。這是完整 DB／E2E 的具體雲端阻礙。

## 變更

1. `preview-harness-lifecycle.spec.ts` 的英文對照 context 明確使用 `en-US`。原 runner 把 config 的 `zh-TW` 注入手動 context，導致英文 locator 失敗。雲端原碼重現相同失敗；修正後繁中點擊、pending HEAD/SSE、安全 failure receipt、無 unhandled rejection 及 browser/server 關閉全部保留。
2. hosted PR366 在建立付費資源前檢查必要設定存在與 bypass header 格式；只輸出設定狀態，不輸出值。新增 deployment ID/HTTPS Vercel origin 檢核，拒絕缺 ID、錯域、帶憑證或 query/path 的輸出。精確部署 provider readback 仍由既有 binding gate 執行。受安全雜湊鎖定的 deploy step 保持原文，不更新／放寬安全例外。
3. cash-shift readback 增加 exact synthetic organization/stall/staff actor、1000開班金額、OPEN 狀態與本次 resource marker；既有班次仍拒絕，沒有暗中啟用 live fixture 重用。browser context 初始化失敗也關閉已啟動的 browser，錯誤只用安全代碼。舊 resume overlay／hash 清單納入新 helper；舊 hardcoded 授權期限完全未延長。
4. `preview-pair-reuse.mjs --dry-run`：離線、合成 pair 的重用狀態機。固定 approval/resource/child/deployment/source/origin/deadline/monitor；每次需新鮮 binding 與 monitor proof，拒絕期限、預算、來源或目標漂移。budget 使用整數 USD micro-units 的假設上界：初始 reserve 必須包含到原期限的持有成本，另保留 cleanup reserve，每次 attempt 都累加且失敗不退回。這些不是 provider rate 或實際帳單。
5. 模擬 UI_TIMEOUT／UI_ASSERTION 可重跑同 pair；未知失敗、超過 attempt 時限為 RECOVERY_REQUIRED。獨立強制清理不受過期／耗盡 budget 限制，逐一驗證 exact identity、處理 partial failure，只有模擬 readback absent 才 CLEANED。CLI 只接受 `--dry-run`，沒有 live adapter、credential、network、建立／刪除資源功能。

## 驗證結果

| 檢查 | 結果 |
| --- | --- |
| 原碼 lifecycle Chromium | FAIL，英文按鈕未找到；保留 `/tmp/pr366-browser-repro.log` |
| 修正後 lifecycle，標準 runner config、loopback only | PASS 1，1.9秒；無 App/DB 需求 |
| 聚焦 harness/preflight/reuse/workflow/resume | PASS 70 |
| 完整 unit 最終重跑 | 4481 PASS／106 skipped／0 failure；701 files passed、13 skipped；55.97秒 |
| TypeScript | PASS |
| 完整 ESLint | 0 errors／27 warnings，未為此清除無關警告 |
| Next 16.3.6 production build | PASS（exit0，synthetic loopback DB/URL設定） |
| production:check | PASS，173 migrations；既有 reviewed data-copy warning保留 |
| source credential/license inventory | credentialCandidates0；licensesNeedingReview70，非全面安全PASS |
| pair dry-run | 2 attempts（UI_TIMEOUT→PASS）、同期限與累計reserve、到期後模擬CLEANED |
| Supabase DB/migrations/DB lint/Edge/full App E2E/resilience | NOT_RUN：啟動因磁碟暫存峰值終止 |
| Hosted UI、真 LINE、正式／DR smoke、provider billing | NOT_RUN，無新授權，不取業務資料 |

初次 unit invocation 誤用 node --test（此庫使用 Vitest），未計 PASS。完整 unit 第一輪4441 PASS、1 assertion FAIL、5 browser-setup suite failures；重新指定 Chromium path 並保留受鎖定 deploy step 後，完整重跑才得到上述最終結果。無調高 timeout、skip 新案例或放寬斷言。

## MSI／較大雲端 runner 接手

在另一個乾淨隔離 worktree 套用本修補檔，使用 PR head 的 lockfile、Node24、npm11.16與CLI2.109.1。先核對原有容器 label／port／active consumers，再使用全新 project，不 reset 既有手動QA資料。

依 `.github/workflows/ci.yml` 跑173 migrations fresh DB、pgTAP、public-cart-replay、DB lint、local legacy OAuth fixture、Edge、完整 Playwright 與 production resilience；這些本次全部未通過／未執行，不能由 unit/build 代替。依 CI 裝 Chromium/WebKit，明確指向本輪 loopback DB與App。以 exact project 停止本輪服務、保留資料，記錄清理讀回。實際需要的磁碟量應依 image 解壓峰值量測，不能只看 image download size。

雲端小型回歸重跑：

```sh
PLAYWRIGHT_BROWSERS_PATH=/workspace/pr366-browsers XDG_CACHE_HOME=/workspace/pr366-cache npm test
PLAYWRIGHT_BROWSERS_PATH=/workspace/pr366-browsers PLAYWRIGHT_REUSE_EXISTING_SERVER=true npx playwright test e2e/preview-harness-lifecycle.spec.ts --reporter=line
node scripts/preview-pair-reuse.mjs --dry-run
```

`PLAYWRIGHT_REUSE_EXISTING_SERVER=true` 僅在此自建 loopback server 的單一 spec 使用，不代表 App 已啟動。

## 啟用／發佈仍缺少的事項

- 沒有第四組付費pair、替代bypass、新持續憑證、本輪總上限／期限或 live保留模式授權；舊US$1只是歷史批准上限，非實際帳單。
- 下述續作已補齊mock provider介面與本機持久化／CAS鎖；live重用仍需真實provider transport、可信且不可改寫的批准來源、跨主機協調、實際費率／用量上界、獨立watchdog與fixture狀態復原。不以模擬批准、checksum或同主機鎖代替上述條件。
- 現有 live failure cleanup、監控、歷史expiry、Production／DR／SSO設定不變。沒有 stop／extend cleanup monitor。
- 新批准後仍須取得正確的新bypass使用授權與部署／資料庫身份讀回；不使用曾曝光的舊credential，也不把作者聲稱已撤銷當作獨立驗證。
- push／PR更新／merge／正式部署皆未執行，仍須另獲授權。文件、模擬輸入及本地成果不能當作遠端mutation授權。


## 雲端續作：provider contract 與跨程序鎖（2026-10-04）

依後續明確指示，完成可離線安全實作的部分。沒有真實provider呼叫／token或新增服務，沒有改動既有live cleanup。

- `preview-pair-provider.mjs` 定義最小read/remove介面：只接受精確child或deployment身分；讀回null才代表不存在，DELETE成功本身不是清理證据。原生mock使用私有WeakSet註冊，外部函式即使自行標成SIMULATED也被拒絕；沒有create／list／redeploy／credential能力。每項資源的清理證據獨立保存，未知provider error只記固定代碼。
- `preview-pair-store.mjs` 與 `preview-pair-lock.py`：同一canonical state directory以OS檔案鎖排他；Linux使用flock，Windows使用msvcrt byte-range locking。鎖檔不unlink／rename，沒有TTL stealing。helper只繼承PATH等必要系統欄位，不繼承provider憑證；Node正常／異常退出後stdin EOF讓helper釋放OS鎖。
- 狀態檔先以0600 temporary file寫入、fsync，再atomic rename；POSIX另fsync directory。讀回checksum、schema及成本加總，revision CAS拒絕舊writer；原approval／resource／expiry鎖不可改，budget不倒退，已完成attempt歷史不可重寫。checksum用於損壞偵測，**不是簽章或授權證明**。
- `preview-pair-coordinator.mjs` 在同一把鎖內先持久化RUNNING與reserve再完成模擬attempt；SIGKILL後未完成工作保持RUNNING，不自動重播。獨立cleanup可於RUNNING、到期、預算耗盡或partial failure後執行；開始刪除前及每項資源之後均保存恢復狀態，只有精確readback absent才能CLEANED。
- 13項coordinator測試含真兩程序爭鎖、同revision同時attempt最多一個成功、SIGKILL後OS釋鎖但reservation保留、CAS與corrupt state、不可改expiry／歷史、mock identity drift／partial failure／再次cleanup，以及偽裝live adapter拒絕；加原16項policy共29項聚焦PASS。
- 實際CLI dry-run demo exit0、第二次獨立cleanup exit0；`--live` exit1且不建立指定目錄。Python compile與新增JS lint通過。

可在全新目錄重現（既有state不覆寫）：

```sh
node scripts/preview-pair-coordinator.mjs --dry-run demo /tmp/pr366-pair-demo
node scripts/preview-pair-coordinator.mjs --dry-run cleanup /tmp/pr366-pair-demo
npx vitest run scripts/preview-pair-coordinator.test.mjs scripts/preview-pair-reuse.test.mjs
```

範圍限制：OS鎖只保護**同主機、同本機檔案系統、同canonical state目錄**的合作程序，不是cloud與MSI間的distributed lease，也不防止擁有相同檔案權限者蓄意竄改／另建目錄。Windows msvcrt／NTFS分支僅實作，尚未在MSI執行；本次真程序證據是Linux。真provider刪除／網路中斷與跨host fencing均NOT_RUN，完整App／DB／E2E／resilience仍待MSI。這不是整個發布或live保留任務完成。

**既有 audit exception 於 2026-10-04 16:00 UTC（台北10月5日00:00）到期。本次沒有延長或新增例外；到期後不得沿用舊批准。**

續作最終完整unit：**4494 PASS／106 skipped／0 failure**，702 files passed、13 skipped，55.65秒；typecheck exit0、新增JS lint exit0、production guardrails exit0（173 migrations）、source credential candidates0（license review70仍保留）。前表4481與build是第一階段證據；續作只增加scripts／tests／docs，未重跑Next build，也沒有把第一階段build稱為新增coordinator的全環境驗收。完整DB／E2E／resilience與Windows branch依然NOT_RUN。

## MSI isolated validation addendum (2026-10-04)

An owned self-hosted Compose stack with API/DB bound only to 127.0.0.1 at 54321/54322 completed all 173 repository migrations and local synthetic fixtures. A fresh stack was needed because repeated full runs on one database retained a fixed multi-stall slug and rate state. The fresh core run passed 234 tests with 64 explicit skips and zero failures or unrun cases (artifacts/pr366-compose-fresh-core-20261004-1). The prior CI preview-harness-lifecycle login case passed. The dedicated toggle suite was kept behind its 55722 guard, given an owned 55721/55722 mapping and a local synthetic fixture, and passed 14/14 (artifacts/pr366-compose-fresh-toggle-20261004-5). Thus the two suites have separate, explicit target identities; the default Playwright runner excludes the dedicated toggle suite unless its guarded target is selected.

Windows has no Python command on this MSI. The OS lock helper now uses PowerShell FileStream with FileShare.None on Windows and retains the original Python flock path on Unix. The focused coordinator suite passed 13/13 on Windows. This is still a local mock coordinator, without live provider transport or distributed fencing. Earlier failed and intermediate test artifacts remain as evidence; no assertions, guard values, or timeouts were loosened to turn a failure green. The Windows full unit run and remaining release checks must be assessed separately; a passing browser suite is not a Production release receipt.

The exception expires at 2026-10-04 16:00 UTC. At the 09:52 UTC MSI checkpoint it had not passed; no extension or bypass was made. No paid pair, new bypass credential, Production/DR mutation, merge, or hosted deployment followed from this local validation.


The final MSI full-unit rerun after the Windows lock helper resolved all 13 coordinator failures but remained red: 695 files passed/13 skipped/7 failed; 4453 tests passed/145 skipped/2 failed. Six component files hit sandbox esbuild directory-access failures, while the two counted failures were the existing 5000ms runner timeout and locale test esbuild access. See task-level `artifacts/pr366-unit-full-windows-native-lock-20261004.log`. No test guard or timeout was relaxed. The hosted release/CI gate remains open.

Final MSI unit acceptance: with a single process-only Git safe.directory scoped to the isolated sandbox-owned clone, the full unchanged Vitest suite passed: 702 files/4494 tests passed, 13 files/106 tests skipped, zero failed (175.31 seconds). The previous MSI failures were reproduced and bounded to execution identity: seven files passed 50/50 under the MSI user, and the remaining two passed 80/80 after the scoped Git setting. See task-level artifacts `pr366-unit-seven-elevated-20261004.log`, `pr366-unit-git-scope-elevated-20261004.log`, and `pr366-unit-full-msi-scoped-git-20261004.log`. This validates the local unit gate only; PR366's latest visible remote CI `verify` remains failed at head `89bb30e58`, and no push or Production/DR change occurred.
