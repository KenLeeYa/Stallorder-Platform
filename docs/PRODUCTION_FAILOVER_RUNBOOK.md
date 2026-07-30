# Production DR 故障切換手冊

## 邊界

StallOrder 的正常狀態只有 Production Primary 可寫，DR 是非同步
`READ_ONLY_STANDBY`。資料庫提升一律由事故指揮核准並人工執行；健康端點或
Cron 不得自動提升 DR。

本手冊不代表已啟用 Production 複寫。只有
`DR_REPLICATION_CAPABILITY_GATE.md`、專案轉換、RLS、Auth、Storage、Edge
Functions 與付款 callback 全部完成後，才可進入實際切換。

## 安全前提

- 使用已保護的 Production Environment，秘密只存在 Secret Store。
- `DIRECT_URL` 與 `DR_DIRECT_URL` 必須是管理用途連線，不放在命令列。
- `FAILOVER_REQUESTED_BY_PROFILE_ID` 與
  `FAILOVER_APPROVED_BY_PROFILE_ID` 必須對應已驗證平台管理者。
- 每次操作都要有不含顧客資料的事故原因。
- 禁止同時把 Primary 與 DR 設成 `ACTIVE_WRITER`。
- 不以 Browser redirect、Realtime 或 CDN 可用推定資料庫可寫。

## 1. 只讀評估

先查看不連線、不寫入的計畫：

```powershell
npm run dr:readiness
```

取得核准後執行實際只讀檢查：

```powershell
$env:PRODUCTION_ENVIRONMENT_APPROVED='true'
$env:DR_CHANGE_CONFIRMATION='CHECK_DR_READINESS'
node scripts/check-dr-readiness.mjs --target DR --apply
```

必須全部通過：

- Primary／DR 可連線且 migration history 相同。
- Primary local identity 是 `PRIMARY`；DR local identity 是 `DR`。
- Fence 已啟用且 DR 為 `READ_ONLY_STANDBY`。
- 複寫連線、schema、觀測新鮮度與 lag 符合 RPO。
- Storage mirror、Auth、Edge Functions、Turnstile、付款 callback 已確認。
- 無進行中的 migration。
- DR sequence 已高於已複寫最大值並保留安全區間。

退出碼 `2` 代表 readiness blocker，禁止繼續。

## 2. 凍結 Primary

先看 dry-run：

```powershell
npm run dr:prepare
```

核准後才執行：

```powershell
$env:DR_CHANGE_CONFIRMATION='PREPARE_DR_FAILOVER'
node scripts/prepare-dr-failover.mjs --target DR --apply --reason "<incident reason>"
```

腳本依序設定兩端 environment-local identity、啟用 fence、推進 DR sequence、
重新檢查 readiness，最後才把 Primary 設為 `SEALED`，並寫入
`PRIMARY_WRITE_FREEZE` 事件。任一步失敗都不得直接提升 DR。

若 DR 尚未提升，可回復 Primary：

```powershell
$env:DR_CHANGE_CONFIRMATION='ROLLBACK_PRIMARY_WRITE_FREEZE'
node scripts/prepare-dr-failover.mjs --target DR --rollback --reason "<rollback reason>"
```

腳本會先確認 DR 不是 writer，才允許同 epoch 解凍 Primary。

## 3. 提升 DR

```powershell
node scripts/switch-active-backend.mjs --target DR
```

確認計畫後：

```powershell
$env:DR_CHANGE_CONFIRMATION='PROMOTE_DR'
node scripts/switch-active-backend.mjs --target DR --apply --reason "<approved promotion reason>"
```

只有 Primary 已 sealed、DR readiness 仍全綠時，腳本才會：

1. 將 `promotion_epoch` 增加一。
2. 將 DR 改為 `ACTIVE_WRITER`。
3. 寫入 `DR_ACTIVE` 事件與 RPO 證據。
4. 輸出需切換的環境變數名稱，不輸出秘密值。

資料庫提升後仍須在 Vercel／Supabase 受保護環境中，將 runtime pooler、
direct/session pooler、Supabase project、Functions 與公開訂單 origin
切到 DR，部署已通過 ephemeral validation 的同一 commit。不得臨時重建未驗證
artifact。

## 4. 驗證

部署後，以腳本回傳的 epoch 執行：

```powershell
$env:DR_CHANGE_CONFIRMATION='VALIDATE_DR_ACTIVE'
node scripts/validate-active-backend.mjs `
  --target DR `
  --expected-epoch <epoch> `
  --base-url https://app.qidaigo.com `
  --apply
```

驗證項目：

- DR runtime 為 fenced `ACTIVE_WRITER`。
- harmless `assert_backend_writable(epoch)` 通過。
- `/api/availability/config` 回報 DR 與相同 epoch。
- `/api/health` 可用。
- QR 新 session、Staff POS、KDS、現金與離線同步使用 DR。
- 舊 epoch 離線訂單先查冪等與既有回條，建立
  `BACKEND_EPOCH_CHANGED` 標記後安全匯入，不直接丟棄。

## 5. 事故證據

記錄但不包含秘密或顧客資料：

- 決策、Primary freeze、DR promotion 與恢復服務時間。
- 最後 replay LSN、複寫 lag、估計 RPO。
- request/approver、原因、部署 commit、Edge Function versions。
- sequence 調整數、Storage/Auth 驗證結果。
- QR false-success 數與 canonical duplicate 數，兩者目標皆為零。

DR 已提升後不可用「解凍 Primary」當 rollback；必須執行
`PRODUCTION_FAILBACK_RUNBOOK.md`。
