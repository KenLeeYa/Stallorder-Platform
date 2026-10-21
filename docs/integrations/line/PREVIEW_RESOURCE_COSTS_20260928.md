# LINE v2 隔離 Preview 資源成本查核

查核日期：2026-09-28（Asia/Taipei）。本次僅查閱 Supabase、Vercel 官方公開資料；未登入控制台、讀取憑證、建立或修改遠端資源。本文是可審閱的成本與隔離計畫，**不是部署、升級方案或產生費用的授權**。金額皆為 USD，未換算匯率或加入稅金。

## 查核結論

| 項目 | 現行官方規則 | 對本次驗收的意義 |
| --- | --- | --- |
| Supabase Preview Branch | Free 不含 Branching；Pro／Team 分支以預設 Micro **$0.01344／小時**起計費，沒有額外固定分支費，但另計其他使用量。 | 若目標組織已是支援 Branching 的付費方案，不必再買第二個方案；建立分支仍增加用量費。 |
| Supabase Nano | Nano 是 Free 的運算規格；付費方案不能新建 Nano，升級後殘留的 Nano 也按 Micro 價格計費。 | 不可把「data-less Nano Preview Branch」列為免費方案。獨立 Free 專案不是 Preview Branch，且免費名額未核實。 |
| Supabase 抵用／上限 | Branching Compute **不適用 Compute Credits**；Branches 不受 Spend Cap 保護。 | 不能用既有每月 $10 Compute Credits 抵分支運算，也不能把 Spend Cap 當成本次硬性費用上限。 |
| Vercel 既有 Pro | Preview 是預設環境。Pro 基本平台費 $20／月含一個部署席次與 $20／月使用額度；另有按量收費。 | 同一既有 Pro team、使用既有部署席次，不必為 Preview 新增方案；不保證新增使用量為 $0。 |

以上依據：[Supabase Branching 計費](https://supabase.com/docs/guides/platform/manage-your-usage/branching)、[Supabase 方案價格](https://supabase.com/pricing)、[Compute 與 Nano 規則](https://supabase.com/docs/guides/platform/compute-and-disk)、[Vercel Pro](https://vercel.com/docs/plans/pro-plan)、[Vercel environments](https://vercel.com/docs/deployments/environments)。

## Supabase：建立與費用估算

Supabase 方案以 organization 為單位，同組織的專案使用同一方案；不能在同一組織內混合 Free 與 Pro。若目標組織目前為 Free，使用官方 Branching 需要升級至支援方案；公開 Pro 起價為 $25／月／組織。若已是 Pro／Team，建立分支不等於建立第二份組織訂閱。本次沒有讀取帳號方案、合約或剩餘額度，因此不能確認使用者實際增額帳單。[組織計費](https://supabase.com/docs/guides/platform/billing-on-supabase)、[方案價格](https://supabase.com/pricing)

Data-less 表示預設不複製正式資料列與 Storage 物件，不代表沒有獨立運算或免費。分支仍複製 schema、設定及 Edge Functions，具有自己的服務與 credentials。`Include Data` 需要 PITR，且可能連同來源運算規格／磁碟需求提高費用；本計畫不需要該選項或 PITR 加購。[Branching](https://supabase.com/docs/guides/deployment/branching)、[Dashboard branching](https://supabase.com/docs/guides/deployment/branching/dashboard)

以下由官方 Micro 單價直接計算，**只有分支 Compute，不是總帳單或費用上限**：

| 計費運行時數 | 計算 | 約略 Compute 費 |
| --- | --- | --- |
| 8 小時 | 8 × $0.01344 | $0.11 |
| 24 小時 | 24 × $0.01344 | $0.32 |
| 72 小時 | 72 × $0.01344 | $0.97 |
| 168 小時 | 168 × $0.01344 | $2.26 |

部分小時也按整小時計費。另可能產生磁碟、egress、Storage 等費用，分支使用量會計入組織方案額度；不應把空資料庫理解為零用量。磁碟按配置容量與時間計算，Storage 按容量與時間計算，實際超額取決於該帳號既有使用量。[Compute 計費](https://supabase.com/docs/guides/platform/manage-your-usage/compute)、[分支計費](https://supabase.com/docs/guides/platform/manage-your-usage/branching)、[磁碟計費](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size)、[Storage 計費](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)

## Supabase：暫停、刪除與停止計費

- 官方明示：實際處於 paused 狀態的 project 不計 Compute；沒有請求但仍在運行，仍計 Compute。這不等於已核實本帳號／該類分支可以手動暫停，也不代表訂閱、儲存等所有費目歸零。[Compute 計費](https://supabase.com/docs/guides/platform/manage-your-usage/compute)
- 官方 Compute 文件說明：project 刪除後停止該 project 的運算計費；已運行的時數仍於帳期結束後結算，刪除不撤銷已產生的費用，也不取消組織既有付費訂閱。必須讀回刪除完成與對應 usage，不能以送出刪除請求代替完成證據。[Compute 計費](https://supabase.com/docs/guides/platform/manage-your-usage/compute)、[組織計費](https://supabase.com/docs/guides/platform/billing-on-supabase)
- Ephemeral Preview Branch 可在其 PR 關閉／合併時自動刪除；Persistent Branch 不會因 PR 關閉或閒置而自動清除。實際整合模式與刪除結果仍需確認。本次收尾應直接針對測試 branch 清理，**不能為省費把變更合併至 Production**。[Branching](https://supabase.com/docs/guides/deployment/branching)
- 本次未取得「暫停分支後所有磁碟／Storage 費用均停止」的官方明確保證，因此不作此承諾。計畫以刪除這個測試分支、讀回資源狀態與結算使用量收尾，不依賴閒置自動暫停。

## Vercel：沿用既有 Pro 的條件

一般 Preview 可使用既有 Pro team 與既有可部署席次；不需要另買 Custom Environment、Preview Deployment Suffix 或 Password Protection。官方列額外可部署席次 $20／人／月；Password Protection 為 Pro 的 $20／受保護 project／月加購，Preview Deployment Suffix 為 $100／月加購。這些都不是本計畫必要項目。一般 Vercel Authentication 可在所有方案免費使用，但真 LINE callback／webhook 的可達性仍須另行驗證。[Pro 方案](https://vercel.com/docs/plans/pro-plan)、[部署管理與保護](https://vercel.com/docs/deployments/managing-deployments)

Preview 的 build、函式、流量等使用量仍受既有額度與各費目規則約束，超額可能加收費用。刪除測試 deployment 不等於取消 Pro 訂閱、退還已用資源或刪除獨立儲存服務；本次沒有帳號 usage，不能承諾額外費用為零。[Pro 方案](https://vercel.com/docs/plans/pro-plan)

**新 project 首次部署的例外：**現行官方 environments 文件明示，新 project 的第一個 deployment 一律為 Production，即使從非正式分支或 CLI 沒有 `--prod`。後續部署才按一般 Preview 規則運作。因此若另建隔離 project，不能只憑命令參數宣稱已建立 Preview；必須事先處理首次部署設定與資源隔離，並讀回 deployment 的實際環境。本計畫優先使用已有首次部署的既有 project 的專用 Preview 分支，不指向正式網域。[Environments／First deployment](https://vercel.com/docs/deployments/environments#first-deployment)

## 本次可審閱的隔離計畫（尚未執行）

1. 確認目標 Supabase organization 已有支援 Branching 的方案、具建立權限；確認 Vercel 既有 Pro team／project／部署席次及剩餘額度。若需要升級、加席次或加購，先更新費用計畫，不將其當作已授權。
2. 建立 **一個 ephemeral、data-less、Micro Preview Branch**，不勾 `Include Data`、不加 PITR、不複製正式客戶資料。使用合成資料完成 LINE v2 驗收。首次建立 Branching 需 Owner／Admin 權限，後續管理權限依官方角色規則確認。[Dashboard branching](https://supabase.com/docs/guides/deployment/branching/dashboard)
3. 以 **24 小時**作初始驗收窗口，估計新增分支 Compute 約 $0.32；若改為 72 小時，Compute 約 $0.97。這是時間與運算預算提案，不是自動延長授權或服務商硬性上限；其他用量另計。
4. Vercel 使用既有 Pro 的專用 Preview 分支與生成網址，環境變數僅限定該 Preview 分支。讀回實際 team、project、commit、deployment environment、資料庫 branch 與生成網址；保留既有 Production／DR 的部署、網域及後端。LINE 測試設定與訊息發送另按已核准範圍處理。
5. 在啟用流量前核對分支帶入的設定、Edge Functions 與排程目的地；data-less 本身不能證明不會呼叫正式外部服務。驗收完停止本次觸發來源、清理精確測試 branch／deployment，保留結果後讀回刪除完成與 usage。不得刪除來源 project／organization，亦不為清理而合併正式分支。

仍待帳號層級確認：Supabase 實際方案／合約／分支權限／其他額度、分支可暫停性、Vercel 現有 Pro 額度／席次／專案首次部署狀態、稅金，以及最後實際帳單。上述資訊本次均未讀取。

## 查核方法與邊界

遵循 AnySearch-first：先讀取本機 skill、`runtime.conf` 與 Node CLI 原始碼，確認對外來源為 AnySearch 服務後，使用其搜尋與 URL extraction 取得上述官方頁面；本次未使用替代搜尋工具。CLI 本機 SHA-256 為 `04A501664FF07B898A1712B9CDD1FE73CEE446FC830677D774FCA55C9841DF77`，此雜湊僅記錄本機檔案，不宣稱已與上游發布物比對。查核沒有操作控制台，也沒有讀取任何帳號 token 或 secret。公開價格可能更新，實際建立前應再次核對官方頁面與帳號報價。
