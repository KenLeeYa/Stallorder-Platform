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

後續PR／run／branch ref／deployment／期限／實際驗收結果於遠端建立後填入，不能以本頁草稿當作已部署。
