# 發布就緒與分批計畫
**決策：本機審查候選；新合規功能 OFF。Production/DR NO-GO。** 本次沒有push/PR/merge/deploy/remote migration/雲端設定/對外通知。不存在本次正式啟用證據，不宣稱法遵或安全認證。

## 四層狀態
| 層次 | 狀態 |
|---|---|
| Code | Phase00–15已逐項處理並記錄；既有可验证控制沿用，新治理API/UI/schema/局部executor已實作。未完成的dispatcher、全主體資料mapping與高風險入口全面step-up見外部清單最後一段，未隱藏成「已完成」。 |
| Local | 完整測試與build結果以VERIFICATION_RECEIPT.json為準；合成DB/API/browser，非真實PSP、法務或硬體證明。 |
| External/legal | EXTERNAL_SETUP_CHECKLIST E01–E18尚有BLOCKED/CONDITIONAL；缺核准告知版本時不能收件，缺MFA時敏感操作停用。 |
| Rollout | COMPLIANCE_ENABLED=false、COMPLIANCE_DELETION_DRY_RUN=true；新schema只在專屬本機lab。既有線上feature版本與候選HEAD不同，不能由local pass推論線上新版可用。 |

## 可分開審查
1. QA子程序隔離、CSV公式前綴、audit log遮罩、webhook IP分類、CI action SHA：不需啟用privacy，仍需共享路徑回歸和各自發布receipt。
2. 治理schema＋已提交audit保護：有5個新migration及DR分類改動。audit子交易相容性已修復；首次套用/升級需對固定tree重新演練，不能只看Plan。
3. 權利請求/複本/hold/incident：核定公司資料、policy、runtime角色、MFA、金鑰、證據管理後，只對具名測試租戶pilot。
4. 實際刪除/獨立archive/更廣高風險MFA：目標清冊、adapter、dispatcher、人工及外部證據全部到位才啟用。完整帳戶刪除及全平台匯出目前不是已交付承諾。

## DR影響
現在的獨立clone不會改變另一個DR工作區、遠端main或provider狀態，已符合「不影響才更新」的本機前提。未來將本分支合併後**會改變DR schema/replication scope與發布tree**；它不是零DR影響的直接可發布更新。不得將本次檔案直接混入34737455830或其他舊Plan。

發布前鎖定main/staging相同tree、Plan/前置收據、Vercel實際project/team/alias/backend/commit及健康回復target。先DR expand、確認135張分類與local step-up隔離，再Primary相容expand、lag/replica identity/sequence驗證。唯一remote writer與Primary可用性要求沿用AGENTS及2026-09-12事故runbook。

## 復原
優先關閉feature/dispatcher並撤銷短效grant；不刪新案件、audit或ledger，不以回滾全部schema作一般復原。APP向後相容讀取既有欄位，新欄位nullable；實際刪除不可逆，復原備份前必須重套刪除/撤銷清單，不能把已刪個資復活。不能rollback安全修正重新開啟已確認漏洞。資料writer切換只能走既有failback，不能直接改兩側環境變數。

正式端只測公開入口與health；authenticated/valid-QR完整正式流程未測，不計PASS。最後provider/health與本機服務狀態見各receipt。
