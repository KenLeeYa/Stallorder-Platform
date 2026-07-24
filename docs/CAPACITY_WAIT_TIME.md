# 產能與等候時間

## 範圍

Phase 3 提供每攤位獨立的等候時間報價、商品產能權重、公開接單自動暫停／恢復，以及店員現場覆寫。店員手動建立訂單不受公開接單暫停影響，但仍會計入後續負載。

## 確定性演算法

`calculate_stall_capacity` 只使用伺服器端可驗證資料：

1. 統計目前 `CONFIRMED`、`PREPARING`、`PACKING` 訂單與品項。
2. 依商品規則計算品項權重與製作時間，未設定時使用攤位預設值。
3. 以近期完成量估算吞吐量；資料不足時，以啟用中的廚房工作站數與預設製作時間計算保守吞吐量。
4. 以訂單數、品項數及加權負載的最高使用率作為攤位使用率。
5. 報價為基礎製作時間加上排隊負載與緩衝，最後限制在攤位設定的最短與最長報價內。
6. 人工等候時間覆寫優先於自動計算，並保留操作原因及稽核紀錄。

顧客送單時會再次計算正式商品狀態、價格、單品視窗上限及攤位容量。前端顯示值不是可信輸入。

## 接單規則

- 達警示門檻時建立容量事件及營運警示，公開頁顯示較長的預估時間。
- 達暫停門檻且已啟用自動控制時，暫停公開 QR 接單並撤銷尚未使用的短效 session。
- 只有由容量系統自動暫停的攤位可自動恢復；人工暫停永遠優先。
- 公開接單暫停不阻擋已授權店員建立現場訂單。
- 超過確認門檻時，顧客必須勾選等候時間確認；Edge Function 仍會在送單時驗證。
- 訂單成立時固定保存 `quoted_wait_minutes` 與 `quoted_ready_at`，後續負載變化不會覆寫原始承諾。

## 權限與方案

- `ORGANIZATION_OWNER`、`ORGANIZATION_ADMIN`、`STALL_MANAGER`：管理設定、商品規則及現場控制。
- `STAFF`：查看負載、暫停／恢復公開接單及覆寫等候時間。
- `KITCHEN`、`FINANCE_VIEWER`：不可存取容量設定或控制 API。
- `WAIT_TIME_QUOTE` 與 `CAPACITY_CONTROL` 由後端方案權益判斷；商品級規則另受方案設定的數量限制。

所有資料表啟用並強制 RLS，公開送單只透過受信任 Edge Function 及 SECURITY DEFINER RPC；匿名角色沒有直接資料表寫入權限。

## 驗證

- pgTAP：`supabase/tests/database/capacity_wait_time.test.sql`
- 合約單元測試：`src/lib/capacity-contract.test.ts`
- UI／授權 E2E：`e2e/capacity-wait-time.spec.ts`
