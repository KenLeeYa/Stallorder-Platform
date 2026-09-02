# Test Plan

## 已執行

- Prisma schema validate 與 client generation。
- Domain/unit：state transition、refund decision、retry/dead-letter、加密防竄改、redaction、runtime gates、strict checkout schema。
- Adapter：idempotent replay、tenant isolation、allowance、allowance void、timeout、Provider 4xx/5xx、unsupported capability、live fail-closed。
- UI：結帳 blocker、server-enabled invoice choices、`TEST / 非合法發票` 標示。
- DB pgTAP：七張表、RLS/privileges、flags、composite FK、cross-tenant rejection、immutable policy、hash、original document unique、test marker。

## 必須在後續階段新增

| 階段 | 必要證據 |
|---|---|
| Sandbox | 官方 fixture、簽章 golden vectors、issue/query/void/allowance、webhook replay |
| Pilot | 單一真實商家核准、財政部／Provider 對帳、異常復原與客服流程 |
| Production | 漸進 rollout、監控告警、credential rotation、DR、負載與安全測試 |

CI 不需要也不得包含真實統編、字軌、Merchant ID、HashKey/HashIV 或 Production API key。
