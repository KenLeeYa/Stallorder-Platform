# LINE Pay 操作與不確定結果

狀態：transport 本機已測；商家操作 UI、持久化作業、退款／對帳入口尚未實作。以下是必須落地的營運規則，現在不能當作可操作功能。

| 情況 | 協定判斷／應採操作 |
| --- | --- |
| Request `0000` | `PENDING_AUTH`；不能印已付款收據、完成單或觸發計費 |
| Check `0000` | 尚未完成授權，保持等待 |
| Check `0110` | 可進入受控 Confirm，不是已付款 |
| Check `0121` | 取消或過期；仍須考慮已發出的 Confirm 是否未定 |
| Check `0122` | Check 回報失敗；不能覆寫已有成功付款證據 |
| Check `0123` | 需以 detail／本地證據對帳，不直接相信回跳參數 |
| Request 回應遺失 | 保持 UNKNOWN，不能假定沒有交易而新開第二次支付 |
| Confirm 回應遺失 | 使用同一商家、憑證版本與交易 ID 查證，不盲重送 |
| Refund 回應遺失 | 保留該筆退款額度，查詢退款明細後再收斂；不重送部分退款 |
| HTTP 200 + 非成功 returnCode | 按 endpoint 解析；transport 拋出的錯誤不是訂單可重付的證據 |
| 429、5xx、1900/1902/1999、格式錯誤 | 保守標示 unknown／待查，禁止 transport 自動重送 |
| 兩筆外部交易皆成功 | 兩份證據均落帳、超收告警及受控退款，不丟第二筆 |
| 已付款但店家不接單 | 付款與接單狀態分離，走客服／受控退款，不能假裝完成 |

Transport 的 `CONFIRMED` 只代表收到符合該次 request context 的 provider 證據，不代表本地付款、Order、KDS 或 Billing 已提交。下一批必須以 DB 交易與 durable outbox 完成關聯。

退款金額必須是正整數 TWD，明確傳 `refundAmount`。本模組不驗證員工退款權限、可退餘額或並行退款保留，因此不可直接掛到公開／商家 API。

緊急停止應只關閉新 checkout；既有 pending／unknown 的查詢、稽核與受控退款必須繼續。回復程式時保留全部交易紀錄，不 drop table、不把不確定付款改成現金重付。

每次操作應記錄安全 operation ID、tenant、狀態、耗時與 provider error code；不記錄 secret、簽章、回跳 state、token 或完整顧客資料。詳見 [待實作資料責任](ARCHITECTURE_DECISIONS.md)。
