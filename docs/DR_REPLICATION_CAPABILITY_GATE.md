# DR Replication Capability Gate

## Result

The isolated capability proof passed on 2026-07-29 using synthetic data only.
It verified publication creation, replication credentials, slot/subscription
creation, network/SSL connectivity, subscriber observation and one-way apply.
One synthetic row appeared exactly once. The CLI-observed upper bound was
7,774 ms; this is a proof measurement, not a Production RPO.

The isolated source and target branches, publication, subscription, slot and
synthetic data were removed after the proof. Production and persistent Staging
were not modified.

## Production gate

The proof establishes technical feasibility only. Production enablement still
requires:

- approved DR project conversion;
- matching migrations and RLS;
- all selected tables having primary keys;
- DR fencing enabled before subscription creation;
- measured initial copy duration and steady-state lag;
- WAL/slot growth alerts;
- Auth and Storage continuity checks;
- rollback rehearsal.

If any gate fails, retain the warm-standby backup architecture and publish the
higher measured RTO. Do not use unsupported replication workarounds.
