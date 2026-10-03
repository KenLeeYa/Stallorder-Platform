# PR366 CodeQL triage — 2026-10-03

## Evidence and scope

Read-only review of GitHub check run `111096524006`, annotations obtained through `gh api repos/KenLeeYa/Stallorder-Platform/check-runs/111096524006/annotations --paginate`. The annotated revision is `756554a7f5dc35ac3b195edd68d27af1e0da52e0`. There are **18 annotations: 16 failure-level and 2 warning-level**. Source at that revision was checked where line attribution could drift.

No alert was dismissed, no product code or security gate was changed, and this document does **not** establish an all-pass security result or authorize release. The findings remain tracked. No externally exploitable high-risk vulnerability was confirmed in these 18 annotations; that conclusion is limited to the reviewed source paths and is not a general vulnerability assessment. Real Preview QA and other release gates remain separate requirements.

## DOM text reinterpreted as HTML — 2

| Annotated source | Evidence | Assessment |
|---|---|---|
| `src/components/shared-catalog-manager.tsx:1728` | `src={objectUrl}` is a native React image. The crop component obtains the URL with `URL.createObjectURL(file)` and revokes it on effect cleanup; it does not insert DOM text into HTML. | False positive for HTML reinterpretation. No `innerHTML`, `outerHTML`, or `dangerouslySetInnerHTML` sink exists in this component. |
| `src/components/localization-dashboard.tsx:100` | Next `Link` uses a fixed `/merchant/localization/preview` path, interpolated query values, and `target="_blank" rel="noopener noreferrer"`. React renders the locale label as text. | False positive for HTML reinterpretation. Query construction could be made explicit with `URLSearchParams`; this is not evidence of an HTML execution sink. |

## Password hash with insufficient computational effort — 3

| Annotated source | Actual purpose | Assessment |
|---|---|---|
| `src/server/auth/oauth/crypto.ts:14` | SHA-256 converts a server-only `OAUTH_STATE_SECRET` of at least 32 characters into a 256-bit AES-GCM key. Encryption uses a random 12-byte IV. | Not human-password verification. Deployment secret entropy remains an external configuration requirement; length alone does not guarantee entropy. Do not replace this with a password hash simply to silence the alert. |
| `src/server/auth/oauth/crypto.ts:38` | `hashOAuthEvidence` hashes random state/nonce, authorization-code evidence, and provider subject identifiers. `transaction-service.ts` creates state and nonce through `randomBytes(32)`; PKCE verifier uses `randomBytes(64)` and its separate challenge is SHA-256 S256. | Not human-password verification. Subject hashes are identifiers, not anonymization guarantees. Provider authorization-code entropy is provider-controlled. Preserve PKCE S256 and track secret-handling separately. |
| `src/server/reports/report-email.ts:18` | SHA-256 fingerprints `[report-email-v1, simulated, from, apiKey]` to reject changed provider settings before sending. The actual API key is sent only to the fixed Resend API with `redirect: "error"`. | Not human-password verification. This is a configuration binding, not a credential verifier. |

## Potential filesystem race — 11

These scripts run in trusted local/CI workspaces, not public HTTP handlers. A concurrent same-permission writer can still change files between checks and use. A check cannot provide immutable-byte proof on its own.

| Annotated source | Reviewed behavior and residual risk |
|---|---|
| `scripts/security-compliance-check.mjs:22` | Existence/type/size checked before read. A concurrent replacement can cause failure or scan a different file; single-FD open/fstat/read would tighten the binding. |
| `scripts/measure-responsive-paired.mjs:55` | Existing runtime-contract file is checked/read, or newly written without exclusive-create. Concurrent runs could overwrite the baseline. Use exclusive-create and handle existing files without replacing them. |
| `scripts/measure-responsive-bundles.mjs:20` | `statSync` size and subsequent hash read can observe different versions. Read once and derive size/hash from the same bytes. |
| `scripts/lib/web-release-dependency-audit.mjs:203` | Generated-Prisma walker checks realpath/type then reads JS. A concurrent local replacement is a genuine evidence-integrity race. Existing source/tree/artifact hashing and containment checks remain necessary; a same-FD read plus fstat would further harden it. Do not remove the release checks. |
| `scripts/awesome-optimization/batch-4a/runtime.mjs:16` | Receipt write uses `flag: 'wx'`; a competing create fails rather than overwriting. Check-before-write warning does not establish overwrite vulnerability. Failure after spawn may still require exact owned-process cleanup. |
| `scripts/awesome-optimization/batch-4a/database-constraints.mjs:32` | Success receipt uses exclusive `wx`; competing create fails closed. |
| `scripts/awesome-optimization/batch-4a/database-constraints.mjs:33` | Failure receipt also uses exclusive `wx`; no overwrite. A concurrent receipt can mask the original exception with EEXIST. |
| `scripts/awesome-optimization/batch-3/runtime.mjs:16` | Receipt write uses exclusive `wx`; no overwrite. Same process-cleanup limitation as batch-4a runtime. |
| `scripts/awesome-optimization/batch-3/database-cas.mjs:57` | Final receipt uses exclusive `wx`; no overwrite. EEXIST can replace the intended error/report outcome. |
| `scripts/awesome-optimization/batch-2/fixture.mjs:60` | Freeze file check/read or non-exclusive creation. Concurrent writers can replace immutable-baseline evidence. Exclusive creation is the minimal improvement. |
| `scripts/awesome-optimization/batch-2/capture.mjs:11` | Snapshot existence is checked before non-exclusive write. Parallel capture can overwrite a preimage. Use exclusive creation for snapshots and manifest receipts. |

Five flagged writes already have exclusive-create semantics. The remaining reads and non-exclusive writes deserve tooling hardening, but the reviewed source does not demonstrate a remotely reachable product exploit. These are not dismissed as universally safe: keep them tracked as local evidence-integrity and concurrency risks.

## Preview binding network/file warnings — 2

- `scripts/qa-pr366-preview-binding.mjs:68`: outbound fetch uses fixed `https://api.vercel.com`, fixed team/project constants, and encoded deployment IDs. Receipt ownership, branch, source SHA/tree, provider child identity, aliases, and unchanged Primary deployment are checked. No caller-controlled host is concatenated into the network origin. The annotation does not establish SSRF. Adding `redirect: 'error'` would make the fixed-origin assumption explicit rather than relying on provider behavior.
- `scripts/qa-pr366-preview-binding.mjs:79`: the output destination is a trusted CLI argument, not a provider-returned path; `writeFileSync(..., {flag:'wx'})` prevents overwrite. The saved result is an explicit sanitized projection of validated provider fields, not a raw credential response. Restricting output to a designated evidence directory would provide additional local-path defense. This is not proof that arbitrary untrusted scripts may safely invoke the collector.

## Remaining status

All 18 annotations remain undisposed in this review. False-positive assessments are source-specific; residual tooling risks remain recorded above. Any later triage/dismissal should reference the exact revision and reviewed sink or exclusive-create semantics. New source changes require fresh review. Production publication still requires the independent release checks and actual affected-flow QA; neither CodeQL annotation severity nor this triage substitutes for those checks.
