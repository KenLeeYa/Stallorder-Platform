# Pickup-ready dialog hotfix

This candidate starts at Production `4e95d2ea`. The public order tracker displays the pickup-ready dialog only for takeout orders in `READY`. A later status outside `READY` clears the dialog even when the API still returns a pickup code. Existing alert deduplication and the inline pickup code remain unchanged.

The Chromium component regression exercises the real tracker with synthetic API responses for completion, cancellation, expiry, repeated READY, manual dismissal, and fulfillment-type transitions. Hosted Preview validation must use an isolated synthetic order and confirm that a retained customer tracking page closes the dialog after staff completes pickup. Production publication is outside this change.
