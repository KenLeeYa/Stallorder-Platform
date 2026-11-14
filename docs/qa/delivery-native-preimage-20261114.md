# Complete native database preimage capture

The new protected read-only step captures the actual principal, four function definitions and their OIDs/owners/ACL/configuration, the absent helper, and all 146 complete migration records. It binds the existing executor contract and frozen product `0d2b27144fcf589bb887e669c09e82158e3de7a2` / tree `e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0`. It introduces no mutating Production executor.

## Capture and admission

The collector makes one bounded read-only psql call through the existing exact native password transport. Credentials stay out of arguments and returned values. Complete parsed JSON stays in memory, then an AES-256-GCM/HKDF-SHA256 archive encrypted with the existing PAT. Only bounded encrypted chunks, source digests and non-sensitive metadata reach the run log; there is no artifact upload or new key. Raw means parsed JSON, not original stdout bytes. The existing PAT must remain available until recovery is retired; rotation requires fresh capture.

The consumer requires an independently reviewed immutable control contract and product-bound version list. It authenticates the owner-dispatched main run, standard GitHub runner group and identity, successful ordered steps, immutable source files, event timing, unchanged final metadata and five-minute native freshness. It then re-verifies the complete decrypted state. Encrypted bytes alone do not establish provider origin or release authority.

## Verification

- The full updated control suite passes **1,036/1,036**, with no skips. Scoped lint, all three workflow YAML parses and **31** production workflow-contract tests pass.
- The transport review passed 109 relevant regressions, including the 80-test transport/executor/capture subset. Two mutations confirmed that disabling read-only or omitting raw state fails. Receipt SHA256: `2926700b4106f4838dc01c40afd6009702f9825f71134aee505fbced3e07442f`.
- Archive/producer review passed 53 related tests and 11 additional integrity cases. Receipt SHA256: `d30ff3b6d2cd1c64932d50dc84455d8035679978fbc8ead12ff1165b737c8922`.
- Loader review exposed missing runner-group provenance. Two failing negatives reproduced it; the fixed verifier requires GitHub Actions group 0 and a positive runner ID. All 23 loader tests pass, including expiry during final readback and a backward clock. Independent loader/archive testing passed 37 cases; removing the runner guard fails the two negatives. Final review receipt SHA256: `a294a8ca210df7ce2486d4670a863a8478049422dc0d0a1c0a9c747de9090f89`.

[Owned native SQL rehearsal](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/43553797881), job `132321963389`, verified the complete preimage on PostgreSQL 17.6, rejected migration 147, restored 146 and removed owned orders/sessions. Independent hosted receipt SHA256: `0495518b1313e8e28584b6d9bf22ee744c56200b9d4c68bdd152a0c421112d11`.

[Owned encrypted roundtrip](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/43556249771), job `132329643020`, succeeded at qualification control `d985a35f726c598f2eaf6eff363c0e6a8cf9c5a0`. At `2026-11-14T04:23:36.477Z`, it reconstructed 258 encrypted chunks and re-verified all 146 migration records and four definitions. Owned order/session counts were both zero at `04:23:42.301Z`, and service cleanup succeeded. Raw log SHA256: `5960d7a451193ae32a329ad57200a548403f206fb01881337d08de42c625ced8`. This dedicated checkout ran the original 23 preimage, 29 recovery and 14 archive tests (66 total); the installation also includes transport/producer/loader tests.

## Remaining release evidence

The owned rehearsals use synthetic token/endpoint metadata, public standard GitHub runners and isolated loopback PostgreSQL. They do not establish actual Primary authentication or protected loader execution. Actual Primary capture, the mutating native executor, five-Edge recovery, old-App compatibility, combined Plan/Apply and live Production acceptance remain separate unfinished gates. No new paid resource, billing change or Production mutation is introduced here.
