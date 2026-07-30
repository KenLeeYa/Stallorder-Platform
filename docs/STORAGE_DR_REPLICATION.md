# Storage DR Replication

Database logical replication does not copy Supabase Storage bytes.

## Implemented flow

```text
Product image or immutable public menu snapshot upload to active Storage
-> application database outbox transaction
-> storage_replication_jobs claim
-> source download
-> SHA-256 verification
-> DR upload with the manifest content type
-> DR download and checksum verification
-> manifest marked MIRRORED
```

The product upload succeeds even when the DR outbox enqueue or object copy is
temporarily unavailable. Failure is audited and never exposes an object
credential.

`GET /api/cron/storage-replication` performs bounded batches with five
attempts and exponential backoff. It requires the existing constant-time cron
authorization. The reviewed Vercel schedule runs every five minutes after DR
credentials and worker ownership are configured.

## Read path

New uploads return a stable application URL under
`/api/assets/product-images/...`. The route reads the active Storage origin,
then the standby, then returns a cacheable not-found response. It accepts only
the fixed product-image path format and never forwards client-selected origins.

P4 adds public, sanitized JSON menu snapshots under
`/api/assets/offline-menus/...`. Their version/hash paths are immutable and the
route permits only the fixed organization/stall/version/hash form. Full staff
snapshots, disabled products, credentials and customer data are never published.

Existing direct Supabase image URLs remain valid and can be migrated later
without blocking this release.

Alert when failed or pending manifests remain for 15 minutes. A Storage mirror
failure must not promote a missing image as healthy. During an incident the
application may use a placeholder, while order product snapshots remain
authoritative.

The DR readiness snapshot compares the Primary and DR object-path inventory and
requires every manifest checksum to be `MIRRORED`. Equal row counts alone are
not accepted as Storage continuity evidence.
