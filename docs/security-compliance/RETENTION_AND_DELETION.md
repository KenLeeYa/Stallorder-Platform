# 保留、保全、刪除與還原
預設 COMPLIANCE_DELETION_DRY_RUN=true。retention_policy_versions 沒有自動核准或「法定天數」seed；記錄資料類別、版本、起算事件、天數、法律基礎、核准人/生效時間。發布版本不可覆寫。帳務由年度決算後起算，contact由用途結束起算，不能互換。

legal hold需organization、可選order/stall、類別、理由、核准人、review/expiry。逾期未review仍保留，不靜默解除；解除需owner MFA與理由/actor。ACCOUNTING_BOOK保全不自動保全CUSTOMER_CONTACT。廣泛整租戶hold必須核對必要性。

流程：核對本人→owner審查核准→預演固定request/version、order updatedAt、policy、hold、各目標數量/阻擋原因及digest→執行時重查row lock/digest/期限/lease/MFA→同交易處理資料、task、tombstone、audit/outbox→外部未驗證維持BLOCKED，不全完成不結案。重試跳過完成目標。

已實作DATABASE_CONTACT（姓名/電話/地址/備註/指定顯示欄位）、PRINT_PAYLOAD（結束job payload）、NOTIFICATIONS（撤銷order contact，取消待送/失敗jobs）、EXPORTS（同訂單複本撤銷/清除）。保留財務snapshot、payment/refund、stock、invoice、PAYG、audit。vault秘密及其他歷史free-text仍須完整盤點，不將指定欄位清除稱為整張訂單匿名。

外送在途訂單維持原必填條件。新增erasure request/時間及同租戶FK，只有終態、已驗證DELETE才能移除contact；不能清除erasure標記或重新填入PII。實際PostgreSQL整合已測試預演不刪、contact hold、保留金額/狀態、dry-run阻擋及外部目標未完成。

STORAGE/CACHE/SEARCH/ANALYTICS/VENDOR需證明主體映射、API結果／不存在證據、重試/DLQ與回讀；沒有假成功adapter。這是尚待補足的系統與外部整合，不只是文書簽名。

還原前需獨立最新tombstone與session/device/key撤銷副本，保持outbound關閉，還原DB/Auth/Storage/flags/sequence，重套刪除/撤銷，再核對帳務及negative tests。任何資料/權限復活禁止上線。本機synthetic測試非Production RPO/RTO。


欄位加密支援v1舊讀與v2具key ID的新寫入。切換ACTIVE_KEY_ID時需保留舊KEY/KEYS且固定獨立SUBJECT_KEY，避免receipt與subject tombstone索引隨輪替改變。本機已驗證雙版本讀取、換錯key拒絕及穩定HMAC；實際KMS權限、批次重加密、使用量確認與key退役另列E05。
