# Awesome 安全審查

狀態：2026-10-01 **IN_PROGRESS**，不是完整安全驗收。以下為本次來源／audit 及集中工具審查的具體證據；產品新增 endpoint、實際跨租戶／RLS、Native、完整 lock、秘密／license 和部署驗證仍須後續寫入。

## 當前來源與依賴快照

- 本輪 target：responsive-cross-device worktree，HEAD87230e266281472a71fd764d616be1adf788c635，尚未提交的改動需本次 frozen-source manifests，不借用舊乾淨 HEAD 成果。
- 2026-10-01T02:22:45Z target `npm audit --json` exit1，19 個受影響套件：1 critical／16 high／2 moderate。此為 affected package counts，不等於19個獨立可利用漏洞。manifest／lock／installed Next均16.3.4；npm11.16.0；當時 lock SHA256253DE075F60F5AA54BB31163D24671C9BAD43C8CC8056927A8A31BC61C7C4629。B2仍是唯一 lock owner，之後變動使此快照不能替代最終 audit。
- 清潔 Mobile reference7849df8 的另一份 audit 為24 affected packages，含較舊 Web/tool 依賴；不得整份複製其 lock 或把其數量當 target 結果。
- 詳細脫敏 evidence：`.superpowers/sdd/2026-10-01-awesome-optimization/native-prerequisites-target-audit.json`、`native-prerequisites-audit.json`、`native-dependency-prerequisites.md`。

## 已知發現與處理狀態

| ID | 來源／嚴重性／可重現證據 | 處理與重測 | 狀態／阻擋 |
|---|---|---|---|
| SEC-AW-01 | Next16.3.4 的 GHSA-vcvr-r3jv-pc5j，官方 affected>=16.2.0,<16.3.6；第一修補版16.3.6已發布。Node ImageResponse 使用攻擊者控制的 SVG 才符合描述；src對 next/og、ImageResponse、opengraph-image、twitter-image 查找0matches，套件仍含該 Node component。 | **未執行 exploit，應用可達利用未證明。** 保留B2同框架版本 BEFORE/AFTER；之後唯一安全 writer 依 exact官方patch/peer/license/integrity升最小相容修補，重讀實際 bundled指南、完整受影響 build／Web／shared／Native／auth／E2E，最終 fresh audit；若量測框架版本改變須分列或重測。 | PENDING_FIX／發布 gate 未通過；不聲稱正式站遭利用或其版本相同。 |
| SEC-AW-02 | Target audit high/minimatch／brace-expansion 經 ESLint graph、undici經Wrangler/Miniflare；完整範圍／advisory在 JSON。 | 實際解析 graph／用途與官方最小修補選型，無 audit fix、工具降級或 blanket override。所有保留風險需明確處理／阻擋，不能只修Next後稱audit全綠。 | PENDING_TRIAGE；新merged lock完整 gate。 |
| SEC-AW-03 | Mobile reference Expo→config-plugins→xcode3.0.1→uuid7.0.3，GHSA-w5hq-g745-h8pq，<11.1.1。現有xcode只有CJS require uuid／zero-argument v4；npm建議Expo46 downgrade不接受。 | 有限候選：xcode@3.0.1單一parent-scoped uuid11.1.1 override，MIT/CJS export metadata verified。**未安裝／未修復。** B5須驗publishedartifact及licensebytes、實際CJS resolution、PBX ID、parse/edit/write/reparse、Expo generation/doctor/actualNativebinary、最終merged audit。 | PENDING_B5；不以舊reference QA清除此發現。 |
| SEC-AW-04 | 基礎收據必要step可被省略／降級、CRLF基準不跨平台、source identity漏實際輸入、前置comment令client entry漏掃。 | Genuine20RED→修補35focusedGREEN；最終96foundation+19authority；獨立96PASS、27/27hashmatch，I1–I4 CLOSED；full四required NOT_RUN仍exit1。 | BOUNDED_TOOL_GATE_CLOSED；不是完整產品安全PASS。 |
| SEC-AW-05 | GitHub實際 Preview protection_rules=[]；環境名稱没有required-reviewer protection。 | 两manualjobs在任何mutation前fail-closed actualreadback，14mutationsteps在guard後，3alwayscleanup綁success，owned2workflow exactActionSHA；actualemptyrule拒绝。沒有遠端workflow或policy寫入。 | LOCAL_GUARD_VERIFIED／REMOTE_PREVIEW_BLOCKED。 |
| SEC-AW-06 | 單一已凍結static debt：storefront-mode-nav client→public-storefront→Prisma import graph。沒有 runtime bundle／secret leakage 證明。 | 保留窄hash例外；B2必要時提取純helper＋publicnavigation／bundleparity，新changed edges仍fail。不得把舊例外改成整體client掃描PASS。 | PENDING_ACTUAL_BUNDLE/FOCUSED_SPLIT。 |

## 最終必要驗證仍待執行

新read/write每次server auth/scope、PII projection／cache／late response／SSR；private表RLS/FORCE/grants／source FK／anon/authenticated/cross-tenant；catalog／order／stock／client totals／negativeqty／discount；Web CSRF與Native bearer audience／CORS；provider signed rawbody/destination／immutableintent／UNKNOWN/fence；job owner／最後attempt；analytics先收集allowlist／consent撤回／SDKfault；feedback length／XSS／rate／scope；公開可見性與staleprice；canonical BILLABLE／refund／test-canary；受控aggregate、可選BI資料庫角色只在實際採用後測；新shared/browser/native import graphs與merged licenses/advisories；secrets只PRESENT/MISSING且不入logs/screenshots/bundle。

上述必測未執行不得標passed。外部BI、collector、analytics provider及其他未採用服務，不以造假憑證或新帳號繞過 gate。Physical／provider／Staging／Production coverage分開，read-only公開status不是authenticatedaffectedflow。本輪保持本機未提交，所有部署及外部開關不寫。

## Current finite patch receipt — 2026-10-01T07:18:02.015Z

The historical SEC-AW-01/02 observations above remain immutable. This bounded local candidate patches Next/config16.3.6, six legacy minimatch3.1.5/brace1.1.21 branches, estree minimatch10.2.5/brace5.0.12, and scoped undici7.29.1 beneath Miniflare/Actions. One actual stable-graph npm audit --json, including dev, exits0 with0 critical/high/moderate/low findings; total dependency metadata798. Lock SHA2568a512f94a5a43ecf119f501d84c2d55bf3d913e94a06d84ad3d4ca4221767144. This clears the retained dependency advisories in this specific graph; neither reachability/exploitability nor Production version/exposure is inferred.

Actual caller API checks10/10 and bounded Miniflare/proxy9 controls plus cleanup pass. Full lint initially scans incoming extracted third-party scratch and fails2268errors/2896warnings; all230 error-bearing paths are .superpowers. Root ruling24 adds only .superpowers/** to flat-config globalIgnores as a product-input inventory correction. No rule/severity changes; illegal src TS/TSX still fails and real scripts/e2e remain checked. Required rerun/full unit/build/real auth/B2/order results and remaining gaps belong to security-patch-report.md. No Native, B7, provider, deployment, DR or Production completion.

Security dependency candidate validation (2026-10-01): Next/config16.3.6 frozen source 36c89f8906acc0a74b561202357312fc434905acd778f67c5c46f1d1fdb99da1, BUILD_ID x4Jr477-4gQiDFApkbXvl, artifact 6e2ea442f64adfe15b9b872beaaf87bfa655fec6127e7e21d2de0be395e6f946. Full stable dev-inclusive audit0; dependency caller10/10, runtime9 controls+cleanup, typecheck and lint0errors/9warnings, status-worker10/10 and actual local dry-run, B2 consumers/editor4 groups, authenticated cookie/CSRF/private closure, local same-order130TWD cash payment/KDS/pickup passed. Original whole Vitest exit1 retained:617pass/12skip/3failed files;2 affected characterization files7/7 and separate live node guard13/13 close the named failures.100 existing gated integration skips are not PASS; no fabricated whole-suite green. Detailed raw failures, timestamp-preimage measurement gap, preserved stream-closed server logs and fresh independent review pending are in security-patch-report.md. Next16.3.4 paired performance receipts remain immutable; B7/overall JS/request NOT_MET/trueNative/provider/Production remain open.


## 2026-10-02 B6a 候選邊界（尚待實際 DB/UI 與獨立審查）

私有 product_feedback 新表 ENABLE/FORCE RLS，PUBLIC/anon/authenticated 無直接權限，service_role 明確 CRUD、无 TRUNCATE/REFERENCES/TRIGGER；後端每次 auth、org membership/admin、CSRF、strict DTO、12KB 與 rate limit。Feedback original requestId 只接受同 actor/scope、24h FAILURE audit；不加入 analytics。管理端 keyset anchor 重複 date/status/org/expiry predicate，CAS 更新版本。對應 SQL negative tests 已編寫，未執行不能算 SQL PASS。既有 auth/order/billing/financial authority 不因 analyticsConsent 變更。

Vercel SDK 直接停用；Noop/Test 僅 closed literal events，Production Noop 無網路。詳細分類與保留在 TELEMETRY_DATA_INVENTORY.md。B6b/Native/provider/release 不在這次局部完成宣告。
