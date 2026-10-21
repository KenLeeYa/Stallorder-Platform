# WebPRNT release dependency remediation — 2026-10-21

Status: implemented and locally verified; hosted and physical-device gates remain open.

## Scope and baseline

The owner authorized fixing shared dependency vulnerabilities before releasing the
WebPRNT overnight-recovery change. Work is isolated in
`codex/webprnt-overnight-20261021`, based on Production `5cc15c6a` and print candidate
`3dbacafc`. Other worktrees, printer settings, pending print jobs, payments and
database state are not remediation targets.

The unchanged Production package/lock pair reported 15 vulnerabilities (3 critical,
12 high). The native `scripts/run-npm-audit.mjs` remains unchanged, including its
moderate severity threshold. No advisory exception from PR366 is copied or activated.

## Reviewed changes

| Dependency | Previous | Candidate | Purpose |
| --- | --- | --- | --- |
| Next.js and matching lint config | 16.3.4 | 16.3.8 | Framework advisory fixes, including image SSRF/cache/metadata issues |
| sharp / bundled libvips | 0.35.4 / 1.3.3 | 0.35.5 / 1.3.4 | SVG rendering vulnerability |
| brace-expansion | 5.0.9 | 5.0.12 | Expansion denial of service |
| shell-quote | 1.10.0 | 1.11.0 | Reject line terminators following comment tokens |
| undici | 7.29.0 | 7.29.1 | HTTP/TLS/cookie/DoS advisories |
| source-map-js | 1.2.1 | 1.2.2 | Source-map event-loop denial of service |
| Vite | 8.2.2 | 8.2.4 | Development editor launch escaping; matching PostCSS 8.5.26 |

### Unpatched braces: replace the implementation, not the scanner

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
has no patched `braces` release. The only dependency path here was
`eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces`.
The pinned Next plugin uses only `globSync(pattern, { onlyDirectories: true })`
in `getRootDirs`; the application does not consume fast-glob.

`vendor/next-root-glob` is an explicitly named private compatibility adapter,
installed under the `fast-glob` dependency slot. It uses the existing, maintained
`tinyglobby` 0.2.17 package instead of any braces/micromatch implementation. It keeps
literal directories from recursively expanding, preserves absolute paths, removes
trailing directory separators and rejects excessive nesting/length before globbing.
The lockfile contains the real adapter identity and **no braces or micromatch**.
This is not a renamed copy or a vulnerability waiver.

The adapter intentionally supports only that pinned consumer contract. A regression
test fails if another dependency starts consuming fast-glob, so future upgrades must
reassess compatibility rather than silently applying this narrow replacement broadly.
Next, React, accessibility and TypeScript lint configurations remain intact.

Sources: [Next 16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8),
[shell-quote advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv),
[tinyglobby upstream](https://github.com/SuperchupuDev/tinyglobby), registry metadata
and the exact installed Next `get-root-dirs.js` source. Dependency signatures and
the committed lockfile must be checked again on the release candidate.

## Installation boundary

Node 24 and npm 11.16.0 remain the declared toolchain. Repository `.npmrc` sets
`ignore-scripts=true`: dependency and root lifecycle hooks do not run implicitly.
Use `npm ci`, then the existing explicit `npm run prisma:generate` before tests or
type checking; `npm run build` already generates the client. CI already has this
explicit generation step; the application-only Production Plan now has it too,
with a failing-before/passing-after workflow-order regression. Do not re-enable all lifecycle scripts to make an install
pass. Optional platform binaries must be present through the locked packages.

This policy applies only inside this checkout, not global npm configuration or other
workspaces. Supabase CLI, sharp, Vite/esbuild, Next/SWC and the Worker dry-run must
work after the clean script-disabled install.

## Acceptance and release status

`scripts/dependency-security.test.mjs` covers reviewed dependency versions, absence
of vulnerable implementations, the sole-consumer constraint, shell comment injection,
Next root discovery (literal, wildcard, brace, array, absolute and missing paths),
deep-nesting rejection, native SVG-to-PNG execution with install scripts disabled,
and actual Next/accessibility lint execution.

### Local evidence (2026-10-21)

- Clean `npm ci --ignore-scripts` and explicit Prisma generation: passed.
- Native audit: **0 vulnerabilities**; registry verification: **517 signatures and
  155 attestations**. No suppression, waiver or audit-threshold change.
- Full unit run: **554 files / 3,360 tests passed**, 2 files / 9 opt-in replay cases
  skipped. Two subsequently added native-image/install-policy cases passed in the
  **21-case dependency regression run**; they were not counted in that full run.
  A subsequent Production Plan ordering regression makes the final focused total
  **22 passed**. Only the explicit Prisma-generation step changed after that local
  full application/DB/browser verification; dependency versions and app bytes did not.
- Lint: zero errors, five existing navigation warnings outside this diff. Typecheck,
  UI control audit (335 TSX files), production build, Worker dry-run and all eight
  client bundle budgets passed.
- Fresh isolated database: **146 migrations**, **72 pgTAP files / 1,619 assertions**
  and strict schema lint passed. Windows checkout CRLF initially prevented a literal
  SQL anchor from matching; testing used exact Git blobs exported with
  `git -c core.autocrlf=false archive`, without changing migration SQL.
- Production-mode browser journeys: **22 passed** (login, roles/authorization,
  mobile QR, merchant workspace, Staff/KDS and failed-print recovery). The first run
  had one QR HTTP 502 during a local Edge file-watcher restart; its failure artifacts
  were retained. One bounded rerun after the runtime stabilized passed all 22 with
  unchanged application and test code.
- WebPRNT browser/component recovery: **16 Chromium/WebKit cases passed** using
  the real vendor JavaScript with a synthetic native bridge. This is not hardware proof.
- The nine separately attempted opt-in replay cases refused the isolated DB's port
  57042 because their safety contract requires 56322 (the initial attempt also lacked
  the dedicated functions URL). Their guards were not weakened and they are **not passed**.

The isolated runtime is `webprnt-security-lf-20261021` (API 57041, DB 57042), with
app 3197 and OAuth mock 57931. It contains synthetic data only. Other workspaces and
their existing LINE test database on 56863 were not modified.

Record full tests, typecheck/lint/UI audit, production build, Worker bundle, native
audit/signatures and Chromium/WebKit WebPRNT regressions on the stable candidate.
These local checks do not replace authenticated hosted QA or physical iPad/MCP31LB
overnight-resume validation. Follow Staging and immutable Production Plan/Apply gates;
do not change real print jobs, automatically retry unknown-result print requests, or
declare hardware acceptance from browser fixtures.
