# StallOrder architecture, performance, and security boundaries

## Architecture principles

1. **Server authority**: the server owns principal scope, tenant/stall resolution, catalog/version eligibility, prices, bundles, modifiers, discounts, taxes, capacity, order transitions, payment state, pickup-code allocation, lottery eligibility, and integration deduplication.
2. **One domain contract**: QR, Staff, Kitchen, Merchant, Platform Admin, and native mobile may have different presentation layers but share versioned domain services/contracts. Avoid duplicated business logic in clients.
3. **Fail closed**: missing provider credentials, disabled feature flags, stale menu versions, invalid origins, unauthorized tenants, or failed dependencies must not silently permit writes.
4. **Additive data evolution**: use forward-only, expand/contract migrations. Verify fresh rebuild, existing-production upgrade, DR compatibility, RLS/grants, and rollback/forward recovery.
5. **Observable state machines**: orders, KDS, printing, payments, delivery synchronization, reservations, and notifications use idempotency, explicit transitions, audit events, retry/dead-letter behavior, and reconciliation.
6. **Responsive by contract**: phone/tablet/desktop is part of feature acceptance, not deferred polish.
7. **Capability before exposure**: hardware, OAuth/login, Passkeys, payment, delivery, translation, and e-invoice controls are shown only when the server can prove the required capability/configuration. A visible but unwired module is a defect.
8. **Locale completeness**: UI messages and tenant-owned display data share a locale/version contract; publication validates enabled-locale completeness instead of leaking source-language strings.

## Vercel DR project provisioning boundary

- Vercel `Create Project` MUST omit `ssoProtection`. It creates a Git-unlinked project with no deployment, custom domain, alias, or DNS binding.
- Capture the returned project ID and verify that exact project under the intended account/team before any later mutation. Names, URLs, or a newly listed project are not substitutes for the exact ID.
- Use `Update Existing Project` on that exact ID to PATCH `ssoProtection.deploymentType=all`, then read back the same project and require the value to remain exactly `all`.
- Only after the PATCH and read-back pass may the workflow link Git, deploy, or bind a domain, alias, or DNS record.
- If PATCH or read-back fails, delete only the exact project ID created by that attempt, verify rollback completion, and stop. Never retry by degrading to `all_except_custom_domains` or by linking/deploying first.

## Performance investigation order

Do not begin with broad memoization or framework replacement. Use this order:

1. Measure route/browser latency and error rate on a locked revision.
2. Trace the request from UI event through route/service/repository/external dependency.
3. Count sequential network/database calls, repeated authentication/authorization/catalog loads, overfetch, N+1 queries, large serialization/hydration, and client re-render/fetch loops.
4. Identify the dominant wait using timings, query logs, profiles, or traces.
5. Apply the smallest change at the bottleneck.
6. Re-run the same benchmark plus functional controls and the QA matrix.

Safe optimization patterns when evidence supports them:

- collapse duplicated principal/tenant/catalog reads within one request;
- parallelize independent read-only I/O without changing ordering semantics;
- request-scope memoization for immutable/current-request data;
- bounded cache with tenant/stall/menu-version keys and explicit invalidation;
- database index/query-shape changes backed by `EXPLAIN` and migration tests;
- stream/skeleton only when it improves perceived latency without hiding failures;
- debounce/deduplicate client requests and abort stale fetches;
- keep SSE/polling ownership singular and clean up subscriptions.

Do not cache authorization results across users, trust client prices, reuse QR sessions across customers, or let stale cache bypass sold-out/menu publication changes.

## Security scan scope

For a release or broad architecture change, cover at least:

- authentication, session creation/rotation/revocation, CSRF/origin, local login guards, OAuth/native auth;
- RBAC and object-level organization/stall authorization;
- public QR/order/modify/lottery/pickup-code enumeration and replay;
- server-side pricing, discounts, bundle/modifier validation, payment corrections/refunds;
- upload parsing, size/pixel/content validation, storage names/ACLs, image processing resource limits;
- SQL/RLS/grants/security-definer functions/search_path/migration ordering;
- provider webhooks/signatures/replay, SSRF/egress destinations, credential/redaction boundaries;
- XSS/output encoding, URL redirects, JSON/content-type contracts, log injection;
- dependency and build supply chain, secrets in repository/history/artifacts/client bundles;
- rate limits, idempotency, concurrency races, queue/outbox reconciliation;
- privacy and retention for lottery device tokens, audit logs, customer contact/delivery data;
- printer/bridge capability, print payload injection, vendor callback authenticity, drawer-command authorization, and hardware-status log redaction;
- e-invoice tenant relationships, tax identity separation, provider state transitions, number/track allocation, void/allowance audit, and disabled live-write flags;
- DR replication contract and evidence integrity.

## Tenant-isolation rules

- Resolve organization/stall membership from the authenticated principal and server records.
- Treat route IDs as requested objects, never authorization proof.
- Every repository query/mutation uses principal-authorized tenant scope or an audited system context.
- Database RLS/grants provide defense in depth; service-role paths still perform explicit tenant authorization.
- Tests include same-role cross-organization access, guessed IDs, indirect relationships, batch endpoints, exports, background jobs, and cache keys.
- Error responses avoid revealing whether an unauthorized object exists.

## API and client error contract

- Expected API responses set an explicit JSON content type and stable shape with machine code, safe Traditional Chinese message, and field details when relevant.
- Client fetch helpers check status/content type before parsing. HTML proxy/framework pages become a safe connectivity/system message with correlation ID, not a raw JSON parser exception.
- Unexpected errors are logged server-side with redaction and correlation; responses never include stack, SQL, secret, token, provider payload, or internal host.
- Mutations use idempotency and optimistic concurrency/version checks where duplicate or stale actions are harmful.

## Public-code and lottery safety

- Three-digit pickup codes are convenience identifiers, not sole authorization for sensitive order mutation. Scope by stall/day/status and rate-limit lookup.
- Allocate codes atomically with a uniqueness constraint/transaction and bounded retry; never use a race-prone read-then-write loop.
- Do not collect device serial numbers or invasive fingerprinting. Use an opaque random first-party token, rotate/expire it, hash where stored, and disclose retention.
- Combine privacy-safe token enforcement with server-side rate/anomaly controls; do not rely only on localStorage.

## Hardware printing and cash-drawer boundary

- Browser device detection is advisory presentation data, not authorization or transport proof.
- Keep a server-owned capability record for printer model, transport, endpoint/bridge, paper profile, cutter/buzzer/drawer support, assigned stall/workstation, and last verified health.
- Raw receipt payloads are generated from server-authoritative order records and an allowlisted command builder. Do not accept arbitrary ESC/POS or drawer bytes from the client.
- Print jobs use tenant/stall/order/event/idempotency keys, explicit copy counts, status history, bounded retry, dead-letter/reconciliation, and actor audit for manual reprints.
- A cash-drawer pulse requires an eligible settled transaction or separately authorized no-sale action. Record the actor and result; never infer payment failure from drawer failure.
- Network/vendor callbacks authenticate where the protocol permits and validate tenant/printer/job scope. Logs redact local addresses, credentials, customer contact, and full receipt payloads.

## E-invoice boundary

- Merchant order invoices and platform billing invoices use separate aggregate roots, provider credentials, document numbering/tracks, RBAC, reports, and reconciliation.
- Database relationships enforce organization ownership across order, preference, invoice, provider job, audit, and credential metadata. Client-supplied tenant IDs never establish scope.
- Issue, retry, void, allowance, refund, and provider callback transitions are explicit and idempotent. Immutable fiscal/audit fields are not overwritten as a shortcut.
- Local mock and contract-only adapters never emit live fiscal documents. Live capability requires current credentials/certification, environment flags, hosted verification, reconciliation, and rollback/incident procedure.

## Local-only facilities

- Four role-login buttons, business-hour bypass, deterministic mocks, fixture accounts, relaxed LAN origins, and debug endpoints require an explicit local-development build/runtime guard.
- Production build checks search for and reject active local bypasses.
- Never copy Staging/local users, secrets, or test data into Production.

## Finding remediation rule

For each finding:

1. confirm the source-to-sink path and affected boundary;
2. create a focused exploit/reproduction plus legitimate control;
3. patch only the boundary responsible;
4. run focused tests and related negative/positive controls;
5. rerun the relevant scanner and regression pack;
6. classify as `fixed`, `no_change` (not reproducible/false positive with evidence), `accepted_exception` (owner-authorized and time-bounded), or `blocked`.

Never change production data, weaken validation, suppress a scanner, or perform destructive dependency downgrades merely to clear a finding.
