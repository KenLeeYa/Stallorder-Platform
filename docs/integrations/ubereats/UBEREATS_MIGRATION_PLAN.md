# Uber Eats Migration Plan

Migration `20260821100000_delivery_provider_contracts.sql`：

- order/event/job unique key 改為 connection + provider + external key；
- job type 加入 `ORDER_FETCH`；
- 新增 granular Uber flags，全部 default false。

先在 ephemeral/Staging 檢查 constraint collision、Prisma validation、RLS、job worker 相容性與 rollback。Production 必須先 backup/dry-run 並使用 fresh immutable Plan ID；本次未對遠端 DB Apply。
