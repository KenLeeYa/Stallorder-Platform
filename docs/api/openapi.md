# Public API v1 / OpenAPI 契約

目前只開放經 scope 控制的唯讀菜單。正式對外前應從同一契約產生 machine-readable OpenAPI JSON 並做 breaking-change diff。

```yaml
openapi: 3.1.0
info:
  title: StallOrder Public API
  version: 2026-08-26
servers:
  - url: https://{host}/api/v1
paths:
  /organizations/{organizationId}/catalog:
    get:
      summary: 取得啟用商品
      security: [{ bearerAuth: [] }]
      parameters:
        - { name: organizationId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 50 } }
        - { name: cursor, in: query, schema: { type: [string, 'null'], format: uuid } }
      responses:
        '200': { description: 商品頁與 nextCursor }
        '400': { description: INVALID_QUERY }
        '401': { description: UNAUTHORIZED }
        '403': { description: MODULE_DISABLED }
        '429': { description: RATE_LIMITED }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
```

## 安全與相容性

- Key 格式 `slo_v1_*`；資料庫只保存 SHA-256 hash 與 prefix。
- 需要 `catalog:read` scope；Key 可設到期與 stall allowlist。
- 每 5 分鐘 300 次，回應 `x-request-id` 與 `x-stallorder-api-version`。
- 回應不含成本、內部備註、顧客資料、secret 或 Provider 欄位。
- v1 breaking change 必須建立新版本，不得靜默改欄位語意。
