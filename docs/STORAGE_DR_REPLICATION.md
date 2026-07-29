# Storage DR Replication

Database logical replication does not copy Supabase Storage bytes.

## Implemented flow

```text
Product image upload to active Storage
-> application database outbox transaction
-> storage_replication_jobs claim
-> source download
-> SHA-256 verification
-> DR upload
-> DR download and checksum verification
-> manifest marked MIRRORED
```

The product upload succeeds even when the DR outbox enqueue or object copy is
temporarily unavailable. Failure is audited and never exposes an object
credential.

`GET /api/cron/storage-replication` performs bounded batches with five
attempts and exponential backoff. It requires the existing constant-time cron
authorization. No permanent schedule is enabled until DR credentials and
worker ownership are reviewed.

## Read path

New uploads return a stable application URL under
`/api/assets/product-images/...`. The route reads the active Storage origin,
then the standby, then returns a cacheable not-found response. It accepts only
the fixed product-image path format and never forwards client-selected origins.

Existing direct Supabase image URLs remain valid and can be migrated later
without blocking this release.

Alert when failed or pending manifests remain for 15 minutes. A Storage mirror
failure must not promote a missing image as healthy. During an incident the
application may use a placeholder, while order product snapshots remain
authoritative.
