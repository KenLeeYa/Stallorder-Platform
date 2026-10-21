# PR366 follow-redirects patch and exact-lock approval boundary

Status: follow-redirects and the subsequently approved Vite security patch are implemented locally. Local verification passed; exact-source remote CI is pending; no advisory allowance or expiry was expanded, and no new hosted resource was created.

## Final local Vite verification

Clean npm ci installed Vite 8.2.4 with unchanged Vitest 4.1.11. The complete
root suite, including applicable Native tests, passed **4844 / skipped 109 /
failed 0** across 726 passed and 13 skipped files with
`node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=dot`.
The earlier concurrent run remains recorded as 4833 passed, 109 skipped and
11 browser/fixture timeout failures; an elevated focused run had 123 passes
and one existing fixture timeout. No timeout, assertion or skip was relaxed.
The final serial complete run includes all 124 focused patch/evidence tests.
Web and Native typechecks passed. Full root lint passed with 27 existing
warnings and zero errors; changed-file lint also passed. Independent review
found no concrete remaining issue after correcting historical document wording.
Fresh selected audit is NON_PASS: exactly the original five complete HIGH
entries, JSON-identical to baseline CI 39456477602. Vite and follow-redirects
findings are absent. No new paid resources, deployment or alias mutation.

## Historical Vite blocker and subsequent repair, 2026-10-21

Before the Vite patch, the selected Web audit reported **six HIGH package entries**. The original
five remain present, and follow-redirects findings are absent, but locked
`vite@8.2.2` has an additional HIGH entry containing three launch-editor advisories:

- [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), moderate: Windows percent escaping.
- [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), moderate: editor argument/flag interpretation.
- [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), high: Windows existence-check bypass.

The official advisories list **8.2.4** as the patched version on the 8.2 line.
The exact gate rejected this audit with `WEB_AUDIT_EXCEPTION_UNREVIEWED`.
Owner message `Sentinel_4667d21038ec81918e0646b937fc3b15` subsequently approved
Vite 8.2.2 -> 8.2.4 and its precise binding. Only Vite's version/resolved/integrity
tuple changes; Vitest 4.1.11 already permits Vite 8. No Vite advisory is accepted.
The new selected audit contains exactly the original five HIGH entries,
JSON-identical to the prior approved baseline. They remain NON_PASS/NOT_FIXED.
See the [separate exact amendment](PR366_EXACT_AUDIT_WINDOW_20261019.md).

The audit command was initially denied for potentially disclosing private
dependency metadata. Offline inspection of npm 11.16.0's actual bulk payload
builder proved its 728 entries contain only public registry package names and
versions, no root/linked workspace names or private metadata; six bundled nodes
have public registry parent provenance. A single retry on that new evidence was
allowed and produced the real audit above. No denied audit was routed through CI.

Independent review found a shallow-checkout dependency in the new lock-delta
test. The test now reverses only the approved tuple and checks the entire
reconstructed old lock against both approved digests, requiring no Git history.
The artifact test also uses an already-locked package for its synthetic trace,
so it no longer alters the policy hash to insert a fictitious dependency.

Rebind verification: focused policy/activation/redirect tests **61 passed**;
the artifact NON_PASS/runtime-exclusion case passed separately. The final full
root run (`npx vitest run --maxWorkers=2 --reporter=dot`) passed **4832**, skipped
109, with **zero failures** across 725 passed/13 skipped files. Web and Native
typechecks and changed-file ESLint passed. The first concurrent run exposed the
old artifact fixture's fabricated lock hash and three Windows browser timeouts;
the fixture was corrected without relaxing assertions, and the complete lower
concurrency run above passed. Independent review confirmed both the shallow
checkout fix and real-lock fixture preserve the fail-closed checks.

### Project impact and approved minimum repair

Before repair, Vite 8.2.2 was a `dev:true` lock entry reached through Vitest 4.1.11 and its mocker.
Vitest explicitly accepts `^6.0.0 || ^7.0.0 || ^8.0.0`; 8.2.4 is therefore the
minimum patched release on the current line, with no Vitest upgrade or override
required. The repository scripts use `vitest run`; the config has no API/UI
listener setting, and tracked application source has no direct Vite/editor
import or CLI invocation.

Read-only npm manifest comparison confirms 8.2.4's dependencies, optional and
peer dependencies (including optional peer flags), Node engine, bin and license
match the existing 8.2.2 lock metadata. Funding uses the same URL, expressed as a
manifest string rather than the lock's `{url:...}` form. Thus no transitive
version upgrade is required by changed dependency ranges. The proposed target
tarball is `https://registry.npmjs.org/vite/-/vite-8.2.4.tgz`, integrity
`sha512-lfauXnrf2x0p+UoA+wXh0dgFWnUjCyG6Js95KBkgaCwUU9k0DAHI4W6Q0WCx+h+5g+Alce1y4Zi2QjjK0UvGBw==`.
The implemented lock delta is only the existing Vite entry's version, resolved
URL and integrity. Clean npm ci installed 8.2.4 successfully from this lock;
the exact full-lock hashes are recorded in the separate approved amendment.

Installed-source tracing shows Vitest's middleware-mode Vite server registers
editor middleware but only calls `listen()` when an API port is configured.
A local default `createVitest('test', {run:true, watch:false})` probe confirmed
`middlewareMode:true`, no HTTP server and no HTTP listener; the owned context
was closed immediately. This narrows the presently demonstrated exposure; it
does not prove every future API/UI invocation safe. The Windows percent
escaping and existence-check issues need an editor invocation plus their
specified attacker-control conditions. The editor-flag advisory specifies WSL
and selected editors for the Vite path. The existence-check bypass must not be
dismissed on the assumption that an attacker always needs to create a malicious
file first.

Production uses Next build/start. No direct production Vite source path was
found, but fresh exact-candidate production NFT/SBOM exclusion is **not proven**.
The Web audit intentionally includes development dependencies, so the former new HIGH
entry correctly blocked acceptance until the approved repair removed it.

The approved repair retains the original five findings NON_PASS/NOT_FIXED and
unchanged expiry. Its 11 actual bundled-helper VM tests cover Windows percent
and newline refusal, WSL filename operands, normalized existence checks and
legitimate Windows/Linux filenames and cursor positions; child_process is
entirely mocked, with no editor or listener. An offline old-version comparison
was unavailable (ENOTCACHED), so these are patched-behavior controls, not an
executed before/after proof. Full Web/Native regression and fresh exact-source
CI/build/NFT/SBOM/activation results must still be recorded separately.

## Finding and minimal patch

Exact candidate `b08dbd53c5295b15065841cecbfdfa72351fe120` was pushed without force to the existing PR366 branch. [CI 39481713478](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39481713478) failed with `WEB_AUDIT_EXCEPTION_UNREVIEWED`: the selected Web audit now has six HIGH entries rather than the five approved entries. Its [raw artifact](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39481713478/artifacts/12290249512) contains the additional `follow-redirects@1.16.0` entry and two advisories. [Source scan 39481713356](https://github.com/KenLeeYa/Stallorder-Platform/actions/runs/39481713356) succeeded. Full Web/Native tests in that CI did not run after the audit gate failed.

Both official advisories identify affected versions `>=1.16.0 <1.16.1` and patched version `1.16.1`:

- [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8): array-form headers bypass credential stripping across origins.
- [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c): incomplete regex escaping leaks custom sensitive header names containing `^` or `|`.
- [Official v1.16.1 release](https://github.com/follow-redirects/follow-redirects/releases/tag/v1.16.1).

The dependency chain is LIFF -> send-messages -> LINE Bot SDK -> optional Axios 1.20.0 -> follow-redirects `^1.16.0`. `npm update follow-redirects --package-lock-only --ignore-scripts --no-audit --no-fund` changes only that package's version, resolved tarball and integrity. No manifest, override, parent dependency, advisory exception or unrelated lock entry changed. `1.16.1` is the minimum supported patched version and retains Node `>=4.0` support.

The application imports LIFF core/login/token modules; no direct tracked-source Axios/follow-redirects/sensitiveHeaders call was found. The visible Axios path uses object headers. This is a source observation, not proof of exclusion from a fresh release artifact. Fresh exact-source SBOM/NFT/build evidence remains required.

## Follow-redirects patch verification before the later Vite gate

- Full `npm ci --include=dev --no-audit --no-fund` succeeded, including Prisma generation and the existing Native workspace dependencies.
- Old installed 1.16.0 reproduced custom sensitive-header leakage for both `^` and `|`; installed 1.16.1 no longer reproduces it.
- `scripts/follow-redirects-security.test.mjs`: **11 passed**, using actual loopback HTTP requests. Tests cover object and array built-in credential stripping, object and array custom sensitive headers, same-origin relative redirects retaining legitimate credentials, 307/308 preserving POST method/body, and the installed reviewed version. Array controls explicitly include Host as required for valid HTTP/1.1 requests.
- Full root unit run: **4828 passed / 109 skipped / 2 failed**, 724 files passed, 13 skipped, one failed. Both failures are in `scripts/web-release-audit-exception.test.mjs` because the current lock correctly fails the unchanged old semantic hash. Overall remains NON_PASS. No other executed test failed. The real disposable PostgreSQL test was explicitly skipped this time; its earlier 64-test integration run remains separate evidence.
- `npm run mobile:test`: **29 passed** across eight files after removing an existing cwd-dependent dynamic-import path. Both root and workspace invocation retain the same Web BFF permission/pagination assertions. The test uses a file-relative URL without adding Node or Web server imports to the Native type graph.
- Web typecheck, Mobile typecheck and focused ESLint passed. Full root lint passed with 27 existing warnings and zero errors. Mobile lint passed with two existing import-order warnings in `session-recovery.test.tsx`.
- Independent read-only security review found no concrete reachable surviving bypass or application regression. It noted upstream array-to-object normalization uses the final value for duplicate same-name headers; no application-reachable array caller was found. The tests do not claim preservation of every arbitrary duplicate-header representation.
- Fresh selected Web audit is **NON_PASS / five HIGH**, with precisely the original eslint-config-next / Next ESLint plugin / fast-glob / micromatch / braces chain. Compared with the raw audit from successful CI 39456477602, all five complete vulnerability entries are JSON-identical, not merely the counts; their locked package entries are also unchanged. The follow-redirects findings are absent. This does not remediate or relabel the original five findings.
- A supplemental old-version installation intended to repeat the corrected valid-array control failed with ECONNRESET before completing. Its subsequent tests still used 1.16.1 and are not old-version evidence. The workspace was then completely restored with successful offline `npm ci` from the proposed lock, Prisma regenerated, and final redirect plus root-invoked Native consumer checks passed **14/14**. No transient exploratory package updates remain in the lock or manifest. Old-version local leakage proof is limited to the two custom-name triggers already reproduced; the array flaw additionally has official advisory/source evidence and passing patched regression controls.

## Original lock-rebind decision and subsequent approval

[The original window contract](PR366_EXACT_AUDIT_WINDOW_20261019.md) explicitly says: "Native and any new advisory, version or lock change are excluded." The policy binds the entire semantic lock hash, and activation separately binds committed LF lock bytes. The old approval alone could not activate a different lock. Owner message `Sentinel_a4cb747e08008191a8ca1859de6f791a` subsequently approved only the follow-redirects patch tuple and exact hashes below. The original approval identity/time are preserved, with the new approval recorded separately in `lockRebind`; the old activation cannot transfer.

Only package entry `node_modules/follow-redirects` differs:

| Field | Approved baseline | Proposed patch |
| --- | --- | --- |
| Version | 1.16.0 | 1.16.1 |
| Tarball suffix | follow-redirects-1.16.0.tgz | follow-redirects-1.16.1.tgz |
| Integrity | sha512-y5rN/uOsadFT/JfYwhxRS5R7Qce+g3zG97+JrtFZlC9klX/W5hD7iiLzScI4nZqUS7DNUdhPgw4xI8W2LuXlUw== | sha512-FNvFGzoMLWmE6Yj9spb/zjd7yiNCHiAW9/Tg9CXrQ8wuu32HtlJOwWO11OJafl5FfY3DxTdQ0vj42zU1kvv5jg== |
| Full-lock semantic SHA256 | 00f3c2b4363f58e2485fb9139142ac9d611671ad04e8561150cf35be8015bc6c | 7273203027bb3e4c194cedcc5890bcc9d164c9d41a0b8dee9ae3e1f081c62f97 |
| Committed LF bytes SHA256 | d284d352264e152619d134d21c5323005e2727f314672e74ff3dff54e91379ef | 51d616877d27acbb72a1c788fad7ea6c80abdcd045f99c6254b29b6eaa978732 |

Approved decision: permit only this security-patch delta and its new exact lock hashes while retaining the original five packages, versions, advisory, counts, lint configuration, isolation/activation requirements and expiry `2026-10-22T14:00:00Z`. The policy and verifier now require both exact new hashes and the separate amendment metadata. No additional risk acceptance or extension was granted. Do not synthesize an activation or weaken the checksum/advisory gate.

Approved amendment surfaces:

- `scripts/web-release-audit-exception.json`: only `lockSha256` and `lockBytesSha256` rebind to the proposed values. Preserve the original authorization identity/time and expiry; record any new narrow rebind authorization separately rather than rewriting the original owner's approval as though it covered a different lock.
- `scripts/lib/web-audit-exception-activation.mjs`: the exact `policy.lockBytesSha256` expectation in `validateExceptionWindow`, while preserving fixed window, lint hash, isolation and fresh-candidate proof checks.
- `scripts/web-release-audit-exception.test.mjs` and `scripts/lib/web-audit-exception-activation.test.mjs`: regression coverage rejecting stale/wrong hashes, any extra advisory, any other lock delta and deadline extension. Do not relax assertions merely to accommodate the current failing old binding.
- `docs/releases/PR366_EXACT_AUDIT_WINDOW_20261019.md`: add only the specifically authorized patch amendment and new exact hashes. Preserve the general exclusion of every other version/lock change and record that the old activation cannot transfer.
- This release note and `docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md`: record the actual narrow approval and subsequent exact-source verification result only after they happen.

The approved binding and verifier changes are implemented with rejection tests for old/arbitrary hashes, missing or broadened amendment metadata, unrelated lock changes, new advisories and deadline extension. The prior watcher 39462576114 completed successfully on October 20; artifact 12294465598 is CLEANED, and independent provider readback confirmed the exact child and Preview absent. Fresh exact-source CI, separately authorized paid hosted acceptance if needed, DR backup/restore and Production DB/Edge Plan/Apply/rollback gates remain required. None was bypassed.
