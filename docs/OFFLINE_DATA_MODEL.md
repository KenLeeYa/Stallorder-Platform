# 離線資料模型

## PostgreSQL

### `client_devices`

記錄 organization、stall、profile 與 installation 的綁定。新登錄裝置一律
以 `DISABLED`、`NONE` 建立，不能由前端自行核准。

重要約束：

- `(organization_id, installation_id)` 唯一
- 每個 stall 最多一筆有效 `OFFLINE_LEADER`
- 撤銷、遺失或更換裝置必須保留 `revoked_at`
- organization、stall、profile 與 installation 綁定欄位不可修改

### `offline_stall_runtime_policy`

保存單一攤位的離線寫入模式與風險上限：

- 最長離線分鐘
- 待同步訂單數
- 累計金額
- 單筆金額

`SINGLE_DEVICE_ONLY` 必須綁定同 organization、同 stall 且有效的 Leader。

### `menu_snapshots`

每個版本為不可變記錄，保存完整授權裝置菜單及公開快照的：

- `content_hash`
- `public_content_hash`
- `public_object_path`
- 產生與到期時間

公開物件路徑和內容雜湊不可更新；商品異動必須建立新版本。

### `offline_permits`

只保存 Permit token 的 SHA-256，不保存原始 token。Permit 綁定：

- device、profile、organization、stall
- menu snapshot/version
- roles 與 allowed actions
- promotion epoch
- 發行與到期時間

有效期不得超過 12 小時，每台裝置最多一筆 `ACTIVE` Permit。

### `storage_object_manifest`

增加 `content_type`，讓商品圖片及 JSON 快照在 Primary→DR 複寫時保留正確
MIME type。相同 object path、checksum 與 content type 的工作會重用現有
manifest，不重複排程。

## RLS 與資料庫權限

四個離線基礎表均啟用並強制 RLS。`anon` 與 `authenticated` 沒有直接讀寫
權限；只允許受信任伺服器使用 `service_role`。公開 JSON 只透過
`offline-menu-snapshots` 儲存桶的 SELECT policy 讀取，沒有匿名寫入 policy。

所有表都安裝 backend fencing trigger；後端不再是 active writer 時拒絕寫入。

## IndexedDB

資料庫：`stallorder-offline-pos`

版本化 stores：

1. `device_profile`
2. `device_keys`
3. `offline_permit`
4. `menu_snapshots`
5. `stall_settings`
6. `cash_shift_snapshot`
7. `offline_orders`
8. `offline_order_events`
9. `offline_payments`
10. `offline_print_jobs`
11. `sync_queue`
12. `sync_receipts`
13. `sync_conflicts`
14. `availability_config`
15. `health_history`

每筆記錄包含：

- `schema_version`
- `app_protocol_version`
- `created_at`
- `updated_at`

Bootstrap 使用單一 IndexedDB transaction 寫入 device、Permit、menu、
settings 與 storage capability；只有 transaction commit 成功後才顯示就緒。

資料庫升級只建立缺少的 store/index，不刪除待同步資料。跨分頁同步先使用
`navigator.locks`，不支援時使用 IndexedDB lease 與 BroadcastChannel 心跳。

## P5 離線操作模型

`offline_orders`、`offline_order_events`、`offline_payments`、
`offline_print_jobs` 與 `sync_queue` 由同一個 durability=strict transaction
建立，避免只留下部分訂單。同步回條寫入 `sync_receipts`，衝突另外保存在
`sync_conflicts`，不會因完整 payload 到期而一併刪除。

PostgreSQL 以 `offline_order_sync_receipts` 與
`offline_sync_conflicts` 保存伺服器權威結果，並使用
`domain_inbox` 防止重播、`domain_outbox` 延後處理副作用。
新表全部啟用及強制 RLS，撤銷 anon/authenticated 權限，只允許受信任的
service role。

同步完成的本機完整 payload 保存 7 天，回條保存 30 天；尚未同步或有衝突的
資料不會被自動清除。
