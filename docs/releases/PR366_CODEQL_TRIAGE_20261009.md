# PR366 CodeQL review — 2026-10-09

The exact dependency exception does not waive CodeQL. Candidate c7a593e5d878ebd4c12d34abc291436917c2d209 was analyzed by Source security scan37813997555; upload completed successfully, but CodeQL check113439288084 remained FAILURE with11high/7medium annotations. This is not a passing security gate. Its raw annotations are retained locally. Later source changes need a fresh analysis.

## Reviewed intended behavior, not vulnerability acceptance

| Alert | Claim and reviewed boundary |
| --- | --- |
| #30 | report-email.ts SHA-256 fingerprints email provider configuration to detect changes; it is not a human-password verifier. Sending uses the fixed Resend API and rejects redirects. This finding does not prove the entropy of an actual provider key. |
| #29 | oauth/crypto.ts hashOAuthEvidence records random state/nonce (randomBytes32), authorization-code replay evidence and provider subject identifiers. It is not password verification or a claim of anonymization. |
| #5 | oauthEncryptionKey derives an AES-GCM server key, not a password verifier. This query's classification is distinct from the unresolved formal secret-generation evidence. Length32 alone is not entropy proof. New OAuth must remain disabled until safe CSPRNG configuration and provider acceptance; preserve the existing legacy Google path. The callback must reject a disabled provider before transaction claim/decryption. Actual server login capability readback must verify legacyGoogleEnabled=true, oauthOnly=false and no new enabled provider before/after promotion. No migration-default assumption or blanket disabling of foundation flags is permitted. |
| #8 | shared-catalog-manager.tsx objectUrl comes from URL.createObjectURL(file) and is used as img src. The cited sink does not reinterpret DOM text as HTML. No innerHTML/dangerouslySetInnerHTML/DOMParser sink exists in that file. |
| #7 | localization-dashboard.tsx cited Next Link has a fixed internal pathname and React-escaped text; it is not an HTML reparsing sink. Navigation validation is a separate property. |
| #51/#50/#47 | QA binding, deployment evidence and Production target write selected, validated JSON receipts to CLI-owned exclusive paths. Remote data does not select executable content or an output pathname. Exact project/team/source/alias/cleanup constraints still apply. |
| #46/#42 | Receipts supply validated deployment/resource identifiers, not provider hosts. Fixed HTTPS Vercel endpoints reject redirects and encode identifiers; exact team/project/owner readbacks remain required. |
| #49/#28 | The generic DR fetch helper alone does not restrict hosts. Reviewed caller paths use fixed provider endpoints and validate the approved plan/scope. The Access readback now uses this helper; an actual-callsite redirect regression fails against the previous raw-fetch version and passes after the fix. This disposition cannot be extended to arbitrary helper callers. |

## File-race findings

The real scanner/generated-byte, paired-contract, preimage and lifecycle races were repaired, with same-descriptor reads, scan/hash from the same bytes, exclusive creation and reservation before child/database mutation. Preliminary exists checks on the already-exclusive runtime/CAS/constraint reservation paths are redundant and are being removed while preserving collision errors. No test or scan query is excluded to obtain green results.

The new checked-file-read.test.mjs finding deliberately replaces a file in an isolated mkdtemp directory while testing the descriptor binding; it verifies that path replacement cannot change the bytes read through the open descriptor and that a changed expected identity is rejected. Cleanup removes only the test-owned temporary directory. This is an intentional regression experiment, not a deployed file-writing endpoint; keep the regression.

Each eventual false-positive disposition must bind its current alert identity/rule/source to this reviewed boundary and read back the result. Do not mark unreviewed alerts, alter branch protection, manually post a successful check, or claim that a successful SARIF upload means no vulnerabilities. Current formal configuration proof, fresh final-source CI/CodeQL and hosted acceptance remain separate required evidence.
