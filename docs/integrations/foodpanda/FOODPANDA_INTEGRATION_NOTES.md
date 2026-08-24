# foodpanda Integration Notes

- 官方 webhook 使用預先共享的 Authorization 值；本實作沒有自行發明 HMAC。
- webhook 內含完整訂單，所以可直接正規化並 durable persist。
- 訂單狀態支援 `RECEIVED`、`READY_FOR_PICKUP`、`DISPATCHED`、`CANCELLED`/legacy `CANCELED`、`DELIVERED`。
- vendor order history 最多回看 60 天。
- TWD 以整數內部單位保存；外部 decimal 先以字串做精確縮放，避免浮點誤差。
- Product creation 為 beta/early access，未實作且 flag 預設 OFF。
- Catalog read、full menu、outlet write 尚未實作；相關 flags 不代表能力已完成。
