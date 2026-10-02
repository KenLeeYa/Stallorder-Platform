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

本方案尚未建立上述雲端資源。Production 發布仍須所有必要檢查及新 Plan/Apply；隔離驗證成功本身不是正式發布成功。使用者指定延後的治理設定持續 OFF／dry-run。
