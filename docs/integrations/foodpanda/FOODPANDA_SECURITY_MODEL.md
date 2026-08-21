# foodpanda Security Model

## Trust boundaries

- Internet webhook 在驗證前視為不可信；body 上限 128 KB，只接受 `POST application/json`。
- routing hint 只能找候選 active connection；最終處理仍必須通過該 connection 的 Authorization 驗證與 store mapping。
- API origin 固定，path segment 經 encode 與長度限制，拒絕任意 URL。

## Secret handling

- DB 僅保存 credential reference；resolver 只接受 allowlisted scheme，實際 secret 從環境/secret manager 注入。
- 比對 webhook Authorization 使用 constant-time compare。
- log/audit 不記錄 token、Authorization、secret 或完整顧客電話。

## Data and concurrency

- event payload 先 hash，再以 connection + provider + replay key 去重。
- order/job unique key 亦包含 connection。
- schema 驗證、精確金額換算、tenant/store match 失敗時 fail closed。
- token cache 有 refresh skew 與 process-local single-flight；多 instance shared cache 尚待實作。

## Threats not accepted

跨 tenant store ID、重播、未驗證 webhook、任意 origin、raw secret 入庫、beta product creation、Production runtime 使用 sandbox config，全部拒絕。
