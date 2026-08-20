# ADR-003: Digital waitlist foundation and provisional safety policy

- Status: Proposed for local foundation only
- Date: 2026-08-13
- Scope: QR-P3-01 Digital waitlist
- Production activation: Prohibited until Product, Legal/Privacy, and merchant operations approve this policy

## Context

The digital waitlist needs a tenant-scoped backend foundation before any public UI or Production rollout. A waitlist credential must never become an ordering credential. Notifications must also remain truthful while no external messaging provider is integrated.

## Decision

### Activation

- `DIGITAL_WAITLIST_FOUNDATION_ENABLED` is created with a default value of `false`.
- Every public waitlist operation fails closed while the flag is disabled or cannot be resolved.
- This ADR does not authorize enabling the flag in Production. Product and Legal/Privacy must approve the duplicate-entry, no-show, notification, and retention policies, and merchant operations must validate the hold workflow and duration first.

### Contact and notification policy

- The only permitted channel is `IN_APP`.
- The foundation records a `MOCK_RECORDED` notification event for contract testing and future UI consumption.
- It does not call an SMS, email, push, LINE, WhatsApp, or other external provider and must not label an event as sent or delivered.
- The `NOTIFIED` state change and its mock event are one database transaction. If the mock event cannot be recorded, the state change rolls back and the operation must not report notification success.
- The waitlist schema stores no phone number or email address.

### Duplicate-entry policy

- One stall may have at most one active (`WAITING` or `NOTIFIED`) entry for the same privacy-preserving duplicate key.
- The server derives that key from the stall and a client device identifier; raw device identifiers are not persisted.
- A duplicate request is rejected with a stable conflict code. It does not silently create another queue position or expose the existing public token.

### Hold and no-show policy

- Moving an entry to `NOTIFIED` starts a provisional ten-minute hold. The duration remains a hypothesis pending merchant-operations validation and is not a Production policy.
- A hold expiry does not create an order, assign a table, or automatically penalize the guest.
- `NO_SHOW` is allowed only from `NOTIFIED` after the hold has expired. The foundation adds no blacklist, fee, or cross-stall penalty.
- Staff may cancel a `WAITING` or `NOTIFIED` entry. Terminal entries cannot return to an active state.

### Seating and ordering-session policy

- Seating requires an explicit staff transition, an assigned active dining table, and a newly generated one-time seating exchange token.
- The public waitlist token is stored only as a hash in the waitlist domain. It is never inserted into `qr_codes` or `order_sessions` and cannot call the order-session issuance contract.
- A seated guest must exchange both the public waitlist token and the one-time seating token within a provisional fifteen-minute exchange window. A successful exchange consumes the seating token and issues a new, independently generated dine-in `order_sessions` contract associated with an existing active table QR code.
- The exchange fails closed when the table QR, tenant relationship, feature flag, token expiry, or entry state is invalid.

### Retention

- Waitlist operational data, including the display name, has a provisional maximum retention of 30 days from creation.
- A service-role-only purge contract deletes expired entries and dependent mock notifications. Scheduling that purge is outside this foundation.
- Security audit records use the platform audit-log retention policy and do not retain public or seating tokens.

### Tenant isolation, audit, and rate limiting

- Every waitlist entry, notification, and rate-limit bucket carries both `organization_id` and `stall_id`, enforced by foreign keys and row-level security.
- Authenticated users may read only rows for stalls they are authorized to access; public access occurs only through bounded service-role contracts.
- State changes, seating exchanges, duplicate rejections, and rate-limit rejections produce metadata-only audit events. Tokens and raw device identifiers are excluded.
- Join attempts are limited per stall and hashed client identifier in a ten-minute window. The provisional limit is ten attempts per window.

## State machine

```text
WAITING  -> NOTIFIED -> SEATED
   |          |
   +----------+-----> CANCELLED
              +-----> NO_SHOW (only after hold expiry)
```

`SEATED`, `CANCELLED`, and `NO_SHOW` are terminal. Ordering-session issuance is a separate one-time exchange after `SEATED`; it is not a waitlist state transition.

## Consequences

- Local database, contract, and mock API tests can proceed without pretending an external message was delivered.
- There is intentionally no Production UI enablement, external notification delivery, automatic table assignment, penalty system, or policy configuration in QR-P3-01.
- Changing any provisional duration, limit, duplicate identity rule, or retention rule requires an ADR amendment plus Product, Legal/Privacy, and merchant-operations approval before Production activation.
