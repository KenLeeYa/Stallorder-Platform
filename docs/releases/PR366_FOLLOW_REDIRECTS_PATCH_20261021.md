# PR366 follow-redirects patch and exact-lock approval boundary

Status: local patch prepared; release verification **BLOCKED** on explicit, narrowly scoped lock rebind authorization. No policy hash, advisory allowance or expiry was changed. No new hosted resource was created.

## Finding and minimal patch

Exact candidate `b08dbd53c5295b15065841cecbfdfa72351fe120` was pushed without force to the existing PR366 branch. [CI 39481713478](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39481713478) failed with `WEB_AUDIT_EXCEPTION_UNREVIEWED`: the selected Web audit now has six HIGH entries rather than the five approved entries. Its [raw artifact](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39481713478/artifacts/12290249512) contains the additional `follow-redirects@1.16.0` entry and two advisories. [Source scan 39481713356](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39481713356) succeeded. Full Web/Native tests in that CI did not run after the audit gate failed.

Both official advisories identify affected versions `>=1.16.0 <1.16.1` and patched version `1.16.1`:

- [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8): array-form headers bypass credential stripping across origins.
- [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c): incomplete regex escaping leaks custom sensitive header names containing `^` or `|`.
- [Official v1.16.1 release](https://github.com/follow-redirects/follow-redirects/releases/tag/v1.16.1).

The dependency chain is LIFF -> send-messages -> LINE Bot SDK -> optional Axios 1.20.0 -> follow-redirects `^1.16.0`. `npm update follow-redirects --package-lock-only --ignore-scripts --no-audit --no-fund` changes only that package's version, resolved tarball and integrity. No manifest, override, parent dependency, advisory exception or unrelated lock entry changed. `1.16.1` is the minimum supported patched version and retains Node `>=4.0` support.

The application imports LIFF core/login/token modules; no direct tracked-source Axios/follow-redirects/sensitiveHeaders call was found. The visible Axios path uses object headers. This is a source observation, not proof of exclusion from a fresh release artifact. Fresh exact-source SBOM/NFT/build evidence remains required.

## Verification

- Full `npm ci --include=dev --no-audit --no-fund` succeeded, including Prisma generation and the existing Native workspace dependencies.
- Old installed 1.16.0 reproduced custom sensitive-header leakage for both `^` and `|`; installed 1.16.1 no longer reproduces it.
- `scripts/follow-redirects-security.test.mjs`: **11 passed**, using actual loopback HTTP requests. Tests cover object and array built-in credential stripping, object and array custom sensitive headers, same-origin relative redirects retaining legitimate credentials, 307/308 preserving POST method/body, and the installed reviewed version. Array controls explicitly include Host as required for valid HTTP/1.1 requests.
- Full root unit run: **4828 passed / 109 skipped / 2 failed**, 724 files passed, 13 skipped, one failed. Both failures are in `scripts/web-release-audit-exception.test.mjs` because the current lock correctly fails the unchanged old semantic hash. Overall remains NON_PASS. No other executed test failed. The real disposable PostgreSQL test was explicitly skipped this time; its earlier 64-test integration run remains separate evidence.
- `npm run mobile:test`: **29 passed** across eight files after removing an existing cwd-dependent dynamic-import path. Both root and workspace invocation retain the same Web BFF permission/pagination assertions. The test uses a file-relative URL without adding Node or Web server imports to the Native type graph.
- Web typecheck, Mobile typecheck and focused ESLint passed. Full root lint passed with 27 existing warnings and zero errors. Mobile lint passed with two existing import-order warnings in `session-recovery.test.tsx`.
- Independent read-only security review found no concrete reachable surviving bypass or application regression. It noted upstream array-to-object normalization uses the final value for duplicate same-name headers; no application-reachable array caller was found. The tests do not claim preservation of every arbitrary duplicate-header representation.
- Fresh selected Web audit is **NON_PASS / five HIGH**, with precisely the original eslint-config-next / Next ESLint plugin / fast-glob / micromatch / braces chain. Compared with the raw audit from successful CI 39456477602, all five complete vulnerability entries are JSON-identical, not merely the counts; their locked package entries are also unchanged. The follow-redirects findings are absent. This does not remediate or relabel the original five findings.
- A supplemental old-version installation intended to repeat the corrected valid-array control failed with ECONNRESET before completing. Its subsequent tests still used 1.16.1 and are not old-version evidence. The workspace was then completely restored with successful offline `npm ci` from the proposed lock, Prisma regenerated, and final redirect plus root-invoked Native consumer checks passed **14/14**. No transient exploratory package updates remain in the lock or manifest. Old-version local leakage proof is limited to the two custom-name triggers already reproduced; the array flaw additionally has official advisory/source evidence and passing patched regression controls.

## Exact pending authorization

[The original window contract](PR366_EXACT_AUDIT_WINDOW_20261019.md) explicitly says: "Native and any new advisory, version or lock change are excluded." The policy binds the entire semantic lock hash, and activation separately binds committed LF lock bytes. Thus the current patch cannot be activated by merely recalculating those hashes under the old approval.

Only package entry `node_modules/follow-redirects` differs:

| Field | Approved baseline | Proposed patch |
| --- | --- | --- |
| Version | 1.16.0 | 1.16.1 |
| Tarball suffix | follow-redirects-1.16.0.tgz | follow-redirects-1.16.1.tgz |
| Integrity | sha512-y5rN/uOsadFT/JfYwhxRS5R7Qce+g3zG97+JrtFZlC9klX/W5hD7iiLzScI4nZqUS7DNUdhPgw4xI8W2LuXlUw== | sha512-FNvFGzoMLWmE6Yj9spb/zjd7yiNCHiAW9/Tg9CXrQ8wuu32HtlJOwWO11OJafl5FfY3DxTdQ0vj42zU1kvv5jg== |
| Full-lock semantic SHA256 | 00f3c2b4363f58e2485fb9139142ac9d611671ad04e8561150cf35be8015bc6c | 7273203027bb3e4c194cedcc5890bcc9d164c9d41a0b8dee9ae3e1f081c62f97 |
| Committed LF bytes SHA256 | d284d352264e152619d134d21c5323005e2727f314672e74ff3dff54e91379ef | 51d616877d27acbb72a1c788fad7ea6c80abdcd045f99c6254b29b6eaa978732 |

Required decision: explicitly permit only this security-patch delta and its new exact lock hashes while retaining the original five packages, versions, advisory, counts, lint configuration, isolation/activation requirements and expiry `2026-10-22T14:00:00Z`. No additional risk acceptance or extension is proposed. Until that decision, leave both `scripts/web-release-audit-exception.json` and the activation verifier unchanged. Do not synthesize an activation or weaken the checksum/advisory gate.

Files/fields requiring that decision before editing:

- `scripts/web-release-audit-exception.json`: only `lockSha256` and `lockBytesSha256` rebind to the proposed values. Preserve the original authorization identity/time and expiry; record any new narrow rebind authorization separately rather than rewriting the original owner's approval as though it covered a different lock.
- `scripts/lib/web-audit-exception-activation.mjs`: the exact `policy.lockBytesSha256` expectation in `validateExceptionWindow`, while preserving fixed window, lint hash, isolation and fresh-candidate proof checks.
- `scripts/web-release-audit-exception.test.mjs` and `scripts/lib/web-audit-exception-activation.test.mjs`: regression coverage rejecting stale/wrong hashes, any extra advisory, any other lock delta and deadline extension. Do not relax assertions merely to accommodate the current failing old binding.
- `docs/releases/PR366_EXACT_AUDIT_WINDOW_20261019.md`: add only the specifically authorized patch amendment and new exact hashes. Preserve the general exclusion of every other version/lock change and record that the old activation cannot transfer.
- This release note and `docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md`: record the actual narrow approval and subsequent exact-source verification result only after they happen.

After authorization: update only the specifically approved lock binding and its corresponding hardcoded verifier expectation, add rejection tests for any other lock delta, rerun focused/full checks, commit and push the existing branch, and require fresh exact-source free CI with real Web/Native results. Then seek separately scoped paid hosted acceptance if still needed. DR backup/restore and Production DB/Edge Plan/Apply and rollback gates remain independent and unresolved. The old deadline watcher must be checked after 19:50 UTC; this local repair does not replace it.
