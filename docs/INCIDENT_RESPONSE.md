# 生產事故應變

日期：2026-07-29

## 分級

| 等級 | 判定 | 初始回應 |
| --- | --- | --- |
| SEV-0 | 資料外洩、跨租戶存取、雙 writer、付款完整性失效 | 立即封鎖受影響能力，啟動資安與資料事件流程 |
| SEV-1 | 大範圍無法點餐／結帳、Primary 不可用、訂單可能假成功 | 5 分鐘內指派事故指揮並啟動降級 |
| SEV-2 | 單一 circuit、Realtime、SSE、付款供應商或部分攤位異常 | 使用既有備援並於 15 分鐘內確認範圍 |
| SEV-3 | 可繞過的小範圍缺陷或監控異常 | 建立事件、限制 rollout、排入修正 |

## 角色

- 事故指揮：決定等級、止血、DR 與恢復。
- 應用負責人：Vercel、Edge、QR、Staff、KDS 與 feature flag。
- 資料負責人：Primary／DR、replication、backup、RLS 與 reconciliation。
- 營運負責人：攤位通知、櫃台流程、離線裝置、現金與列印。
- 溝通負責人：內外部狀態更新；不揭露 topology、credential 或顧客資料。

同一人可兼任多角，但 DR promotion／failback 的 requester 與 approver 不可由
同一個 Profile 代替。

## 前 15 分鐘

1. 記錄事件 ID、開始時間、第一個症狀與偵測來源。
2. 停止部署、migration、feature rollout 與非必要營運變更。
3. 檢查 `/api/health`、受保護 dependency health、availability 與集中式日誌。
4. 判斷是否存在假成功、重複訂單、跨租戶或付款完整性風險。
5. 依故障範圍啟用 QR 降級、關閉雙路徑、暫停線上付款或暫停指定攤位。
6. 通知店員使用櫃台點餐、現金／人工付款或已核准 Offline Leader。
7. 每 15 分鐘更新一次狀態，直到服務穩定。

## 快速決策

| 症狀 | 優先處理 |
| --- | --- |
| Supabase Edge 5xx | 確認 Circuit B；不要移除 Turnstile／rate limit |
| Vercel Circuit B 5xx | 關閉 `DUAL_ORDER_INTAKE_ENABLED`，維持 Circuit A |
| Realtime／SSE 失效 | 確認 5 秒 polling 與資料庫權威查詢 |
| Primary 無法安全寫入 | fence／QR 降級；評估 DR，不自動提升 |
| Turnstile 不可用 | 公開送單 fail closed，改櫃台點餐 |
| 單一付款供應商失效 | 只提供其他 `AVAILABLE` 供應商與現金／人工 |
| 兩個線上付款皆失效 | 保留訂單建立，使用現金／人工並後續對帳 |
| Storage quota 壓力 | 停止新上傳，不刪除 pending queue 或既有證據 |

## 溝通範本

顧客：

```text
目前線上送單暫時無法使用。您仍可查看菜單，請至攤位櫃台點餐。
```

商家：

```text
線上服務目前為降級模式，已成立訂單不受影響。請使用櫃台流程並保留待同步
資料；恢復時間確認後將再次通知。
```

不得在公開狀態訊息寫入 Supabase project ref、IP、資料庫角色、security event、
request payload 或個人資料。

## 證據

保存：

- commit、deployment、migration、Edge version 與 feature-flag audit。
- health、availability、replication lag、promotion epoch 與 fencing 狀態。
- request ID、固定錯誤碼、時間線與核准人。
- false-success、duplicate、付款差異、離線 queue age 與 reconciliation 結果。

不得保存：

- Password、PAT、service role key、database URL、session／CSRF／QR／Turnstile
  token。
- 顧客電話、地址、備註、pickup code 或完整 provider identifier。

## 恢復與結案

恢復前須完成：

- Root cause 已被理解或受控隔離。
- 修正通過 Local／Ephemeral、資料庫及安全回歸。
- 先單一內部 Stall，再分批恢復。
- 監控至少一個完整營業週期或經事故指揮核准的觀察窗。

結案報告包含時間線、實際 RTO/RPO、影響、資料差異、有效與無效控制，以及
具負責人與期限的後續行動。每季以
[RESILIENCE_GAME_DAY.md](RESILIENCE_GAME_DAY.md) 執行角色輪替與桌上演練。
