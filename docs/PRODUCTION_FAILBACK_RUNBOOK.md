# Production Primary Failback 手冊

## 原則

DR 成為 `ACTIVE_WRITER` 後，不能只修改 DNS、Vercel 變數或重新啟用舊
Primary。Failback 必須先補齊 DR-era 寫入、sequence、Auth 與 Storage，再短暫
凍結 DR 並提升 Primary。

## 1. 準備 recovered Primary

1. 保持 DR 為唯一 writer。
2. 將 recovered Primary 設為 `SEALED`。
3. 分別建立 Primary 與 DR 備份。
4. 比對 DR-era 的 orders、payments、usage、audit、Inbox／Outbox 與 sync receipts。
5. 將缺漏資料單向補入 Primary，解決衝突並保留證據。
6. 驗證 migration history、RLS、Auth identity mapping 與 Storage checksum。
7. 確認 Edge Functions、Turnstile 與 payment callback 的 Primary 設定可用。

以下確認項目必須透過受保護環境變數標記為 `true`：

```text
PRIMARY_BACKUP_READY
DR_BACKUP_READY
DR_WRITES_RECONCILED
DR_AUTH_IDENTITIES_VALIDATED
DR_STORAGE_VALIDATED
DR_BUSINESS_DATA_VALIDATED
DR_NO_ACTIVE_MIGRATION_CONFIRMED
```

## 2. 凍結 DR

先看 dry-run：

```powershell
npm run dr:failback
```

核准後：

```powershell
$env:PRODUCTION_ENVIRONMENT_APPROVED='true'
$env:DR_CHANGE_CONFIRMATION='PREPARE_PRIMARY_FAILBACK'
node scripts/prepare-primary-failback.mjs `
  --target PRIMARY `
  --apply `
  --reason "<approved failback reason>"
```

腳本會先執行全部證據檢查、將 Primary sequences 推進至 DR 最大值以上，然後
把 DR 設為 `SEALED` 並寫入 `DR_WRITE_FREEZE`。

若 Primary 尚未提升，可解凍 DR：

```powershell
$env:DR_CHANGE_CONFIRMATION='ROLLBACK_DR_WRITE_FREEZE'
node scripts/prepare-primary-failback.mjs `
  --target PRIMARY `
  --rollback `
  --reason "<rollback reason>"
```

## 3. 提升 Primary

```powershell
node scripts/switch-active-backend.mjs --target PRIMARY
```

核准後：

```powershell
$env:DR_CHANGE_CONFIRMATION='PROMOTE_PRIMARY'
node scripts/switch-active-backend.mjs `
  --target PRIMARY `
  --apply `
  --reason "<approved Primary promotion reason>"
```

腳本將 epoch 增加一、提升 Primary，然後把 DR 降為
`READ_ONLY_STANDBY`。若 DR 降級步驟失敗，Primary 仍是唯一 writer、DR 仍 sealed，
操作人員必須修復 standby 狀態，不得解凍 DR。

## 4. Runtime cutover 與驗證

在 Vercel／Supabase 受保護環境恢復 Primary 的 pooler、project、Functions 與
公開訂單 origin，部署先前驗證的 commit，再執行：

```powershell
$env:DR_CHANGE_CONFIRMATION='VALIDATE_PRIMARY_ACTIVE'
node scripts/validate-active-backend.mjs `
  --target PRIMARY `
  --expected-epoch <epoch> `
  --base-url https://app.qidaigo.com `
  --apply
```

確認：

- 新寫入只出現在 Primary。
- DR 不接受正常應用寫入。
- QR、Staff POS、KDS、付款 callback 與離線同步皆使用新 epoch。
- 複寫重新建立為 Primary 到 DR 單向，且 lag 回到門檻內。
- 報表 read routing 只在新鮮且 schema-compatible 時使用 DR。

## 5. 結案

保留兩端備份與 reconciliation manifest，完成事件時間線、RPO/RTO、重複訂單與
付款差異檢查。所有差異歸零或有經核准的處理紀錄後，才進入
`INCIDENT_REVIEW`。
