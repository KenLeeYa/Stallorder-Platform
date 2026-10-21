# 顧客修改既有訂單：新增履約負擔與預約供應期限

狀態：本機候選已實作，聚焦單元測試通過；資料庫、公開 API、真實 UI 與發布驗證待主任务執行。沒有正式部署。

本次增補 [營業時間 QA](awesome-optimization/BUSINESS_HOURS_QA_20261002.md) 保留既有訂單修改的規則：訂單未確認、未付款、未製作且符合既有列印／折扣條件時，備註修改與同配置減量不新增營業時段限制；取消沿用原規則。新增 SKU、任一 SKU 總數增加或新／替換套餐配置則視為新的履約負擔，須重新檢查接單權限。不同備註的同一 SKU 合併數量比較，不能拆行繞過。

## 後端邊界

- 公開 tracking PATCH 使用 Node 的 `editTrackedPublicOrder`，並非建立新單的 canonical RPC；Edge 建單 circuit A 與 Node circuit B 的既有追蹤修改均使用此 PATCH。不能僅因建單 calendar RPC 通過而推定修改受保護。
- 增品／增量／替換套餐配置在原訂單鎖內重新讀取原 QR 的組織／攤位、有效狀態與期限、tenant 狀態、店家啟用／暫停／售罄、外送模組與內用桌位權限，以及既有 schedule validator。內用桌位另以組織／攤位／桌位 ID 精確取得 FOR SHARE 鎖後才讀 active，避免 nullable join 無法鎖定的缺口；guard 另要求 QR 當下綁定的桌位與已鎖定 snapshot 相同，換桌競態不能許可另一張未鎖的桌。DEFAULT／DELIVERY 另呼叫 `public_order_calendar_code` 使用伺服器目前時間；不能以外送未來時間繞過即時停止接單。
- PREORDER 不套當下營業時間；商品與套餐元件供應期限以原 `requestedFulfillmentAt`，其次原 `scheduledPickupAt` 評估，避免用今天供應的商品改進下週已不供應的預約。沒有修改原約定時間。
- PREORDER 增品／增量另呼叫 canonical `validate_takeout_preorder_slot`，使用原履約時間及原 session 建立時間作為 lead time／預約天數參考；目前預約模組停用、原未來時段遭店休／供應時段變更移除或原履約時間已過都拒絕。仍可在今天閉店時增加合法未來預約，減量／備註不重新接單。
- 顧客新增／替換套餐配置不得使用仍在停售期限內的元件；暫停售完是否生效使用目前時間，供應起訖則使用履約時間。同配置保留／減量可沿用原先已接單份數。原 schema 未保存套餐 choice IDs，因此將原 snapshot 唯一反解到目前 choice IDs，再確認套餐商品、group、choice 與 component 的 createdAt／updatedAt 都存在且不晚於原 order item.createdAt，才授予原配置保留額度。名稱／份數相同導致多個候選、snapshot／時間戳缺失、改名、choice／component 同名重建或重新綁定都不授予額度，停售套餐可能須請店員協助；即使只是後來修改價格等欄位也保守不授額度。單靠顯示名稱不能授權替換配置。Staff helper 的新增選項僅由 public edit 啟用，店員仍保留受權照點線上停售元件的既有能力。
- 減量或備註修改仍須通過原本商品可售、付款／確認／製作與列印鎖，這次沒有擴大先前可修改商品的範圍。
- 定價仍由後端取得目前可信任商品／客製選項價格。數字庫存仍由既有 deferred constraint trigger 鎖定並原子核算；拒絕新增負擔發生於刪除原品項、重建品項與事件寫入前。Staff POS 不呼叫本次顧客接單檢查，維持人工建單語意。

## 本次證據與待驗證案例

- 以 HEAD 原始 implementation 的臨時副本執行同一聚焦測試，重現閉店增量仍成功、預約供應評估沒有傳入原履約時間，兩項均失敗；副本已移除。
- 修正後 5 個聚焦測試檔、42 項通過：閉店增量拒絕、既有權限錯誤傳遞、相同數量備註／減量保留、拆行數量比較、未來供應期限與套餐元件、原 Staff POS 建單／價格及列印規則。追加套餐停售案例先取得 2 RED，再驗顧客拒絕、停售到期允許與 Staff 原允許政策。預約模組／原時段重驗先取得 4 RED，再驗停用、時段撤銷／過期拒絕及合法未來時段保持原約定。真實 prepare helper 另驗同配置停售減量、增量拒絕、替換配置標記、重名歧義、同名重建、重新綁定及時間戳缺失拒絕；交易測試驗等量替換套餐仍需 calendar admission、scoped table lock 順序與 QR 桌位變動 fail-closed。
- 測試使用 mock transaction，不能證明 SQL 實際執行、鎖等待與真實 UI。主任务須在隔離 DB／API／UI 驗證開店成立未確認訂單後關店增品／增量拒絕且原單／庫存／總額／事件不變，減量／備註仍可修改；另驗外送停用、內用桌位失效、QR／schedule 停用及原預約未來供應期限。
- 驗證 merchant confirmation／付款／顧客 edit 競態與最後庫存競態；記錄公開 QR、外帶、外送、預約入口及 A/B 建單後共用 tracking PATCH 的結果。未執行項目維持 NOT_RUN，不能稱完整流程完成。

## Root runtime 補充

本機真實 API／DB 9案例及桌位兩連線鎖定原語已通過，精確範圍與未測競態見 [本輪驗證](awesome-optimization/UI_AND_ORDER_GUARDS_20261002.md#核心候選本機驗證2026-10-02未發布)。未做正式發布、真實LINE／Pay；套餐同名重建及快照 timestamp fail-closed 有聚焦測試與獨立來源審查，並非全部分支真實API實測。
