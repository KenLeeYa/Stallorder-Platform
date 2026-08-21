# Uber Eats OAuth Flow

```mermaid
sequenceDiagram
  participant M as Merchant
  participant S as StallOrder
  participant U as Uber OAuth
  M->>S: Begin connection
  S->>S: Create state + PKCE verifier/challenge
  S-->>M: Fixed-origin authorize URL
  M->>U: Authorize eats.pos_provisioning
  U-->>S: code + state callback
  S->>S: Verify one-time state, tenant, expiry, callback
  S->>U: Exchange code
  S->>S: Encrypt token and save reference
```

目前只完成 authorize URL 組裝與 config validation。Callback state storage、single-use enforcement、code exchange、token encryption/reference、refresh/revoke 與 store activation 尚未實作。`UBER_EATS_OAUTH_ENABLED` 與 `UBER_EATS_STORE_ACTIVATION_ENABLED` 必須保持 OFF，直到以上流程與測試完成。
