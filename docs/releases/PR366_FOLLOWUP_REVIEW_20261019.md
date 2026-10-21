# PR366 independent review and local follow-up — 2026-10-19

Local preparation only. This follows commit `1a867403d16700294c34844597fcfa928baa0522` in the same isolated worktree/branch. It supersedes that phase's installation/build limitations, while preserving its historical receipts. No push, workflow dispatch, deployment, Docker startup, paid resource, DR write or replication change was performed.

## Independent review and changes

An independent local reviewer inspected the original commit, the actual session writer/reader and `ephemeral-preview.yml`. No confirmed new regression was found. The reviewer verified exact resourceKey/childRef/deploymentId/SHA/tree binding, required unique ordered session stages, the retained logout200/auth-me401/private-state assertions, and real artifact upload/download/verifier callsites. The receipt itself is structured test output, not a cryptographic signature; its trust depends on the reviewed source, GitHub exact-run artifact ownership and provider readbacks.

The review suggested direct writer-to-reader integration coverage. The early/clickable/race tests now feed the actual `verifySessionRevocation` output into `verifySessionEvidence` and reject a wrong SHA. They retain their existing server status, private-state, invocation-count and redaction assertions.

Full local testing also exposed an existing Windows test teardown race. `preview-pair-coordinator.test.mjs` killed a worker without awaiting its close before tmp-directory removal. The worker's PowerShell helper can still hold `session.lock` with FileShare.None, so EBUSY can obscure an earlier timeout. The normal product lock path already closes stdin and awaits its helper; it was not changed.

The test now registers each owned child immediately, waits for exact child close in finally/afterEach, then removes only its generated tmp roots with 8 bounded retries and 25ms linear backoff. It also tracks the short-lived coordinator children. Lock contention, acquired=true, RUNNING/reservation history, cleanup CLEANED and original test/hook timeouts remain intact. Independent review of this follow-up diff found no confirmed new issue. This fixes teardown ordering; it does not prove that all observed full-suite timeouts were caused by that race.

## Official registry recovery and exact commands

The configured registry remained `https://registry.npmjs.org/`. `npm ping --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=15000` returned PONG (206ms); `npm view next@16.3.8 dist.tarball` returned the official registry URL. No global configuration, mirror, lockfile or other worktree was changed.

The successful clean install was:

```text
npm ci --workspace packages/contracts --include-workspace-root --include=dev --ignore-scripts --no-audit --registry=https://registry.npmjs.org --fetch-retries=2 --fetch-timeout=60000
npm run prisma:generate
```

It installed 660 packages. The existing `verifyWebInstallScope(process.cwd())` passed for Web root production/development plus shared contracts, with Native excluded. Prisma Client 6.19.3 generated successfully. This is local scope proof, not the fresh Linux-hosted release proof; the existing hosted-runner guard was not bypassed.

| Command | Actual result |
| --- | --- |
| `npm run build` | PASS, Next 16.3.8 Turbopack; compile, TypeScript and 131 static pages completed |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS exit 0; 0 errors / 27 existing warnings |
| `npm run ui:audit` | PASS, 396 TSX files |
| `npm run production:check` | PASS, final 3251 tracked inputs / 173 migrations; existing reviewed data-copy/drop warning retained |
| `npm test -- --maxWorkers=2 --reporter=json --outputFile=../phase2-unit.json` | NON_PASS: 4723 passed / 15 failed / 108 skipped, plus 8 Native suite load errors because Expo is excluded from the Web install |
| Failed-suite recheck below, original timeouts, one worker | PASS: 232 / 232; does not erase the full-run failure |
| Final six-suite verification below | PASS: 149 passed / 2 existing Linux-only skipped / 0 failed; no whole-suite or hosted PASS is claimed |

Build used only process-local synthetic settings: DATABASE_URL and DIRECT_URL=`postgresql://postgres:postgres@127.0.0.1:54322/postgres`; NEXT_PUBLIC_APP_URL=`http://127.0.0.1:3000`; NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:54321`; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=`sb_publishable_web_artifact_fixture`; NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL=`http://127.0.0.1:54321/functions/v1`; ALLOW_DEMO_SEED=`false`; NEXT_TELEMETRY_DISABLED=`1`. No real environment file or database connection was substituted.

```text
npm test -- scripts/preview-pair-coordinator.test.mjs scripts/qa-pr366-preview-ui.test.mjs src/components/operations-mobile-records.test.ts scripts/awesome-optimization/repair.test.mjs scripts/lib/web-release-dependency-audit.test.mjs scripts/qa-pr366-session-revocation.test.mjs scripts/verify-pr366-deployment-evidence.test.mjs scripts/pr366-deployment-evidence-workflow.test.mjs --maxWorkers=1 --reporter=json --outputFile=../phase2-focused-recheck.json

npm test -- scripts/preview-pair-coordinator.test.mjs scripts/qa-pr366-session-revocation.test.mjs scripts/verify-pr366-deployment-evidence.test.mjs scripts/pr366-deployment-evidence-workflow.test.mjs scripts/qa-pr366-preview-ui.test.mjs scripts/qa-pr366-preview-ui-supervised.test.mjs --maxWorkers=1 --reporter=json --outputFile=../phase2-targeted-final.json
```

The first full run had browser navigation/action/shutdown failures, script-fixture timeouts and the Windows lock teardown EBUSY. Several failed durations align with existing deadlines; these are observations, not proof of a single machine-load cause. All five failing Web/script files passed the one-worker recheck before the teardown fix. Native load errors remain separately unverified; no Native toolchain was added to make this Web remediation an unlimited prerequisite. DB/Edge/hosted acceptance and fresh final-source CI remain open. Raw logs/JSON stay in the parent task directory, with digests in the follow-up receipt.

The [follow-up validation receipt](PR366_FOLLOWUP_VALIDATION_20261019.json) records final source hashes and preserves the full-run, recheck and final-suite results separately.

## Dependency removal assessment and proposed next change

The current official selected audit remains five HIGH findings:

```text
npm audit --workspace packages/contracts --include-workspace-root --include=dev --audit-level=moderate --json --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=15000
```

The production-only diagnostic with `--omit=dev` still reported two HIGH entries (braces/micromatch). `npm explain braces --json` attributes the actual installed root chain to the dev eslint-config-next dependency; the audit output and aggregate lock flags are not an independent proof of a clean runtime artifact. Merely omitting dev dependencies is not a repaired release gate.

Official metadata/source inspection found:

- Installed @next/eslint-plugin-next 16.3.6, latest stable 16.4.2 and canary 16.5.0-canary.17 all depend on fast-glob 3.3.1. Latest fast-glob 3.3.3 still depends on micromatch, and latest micromatch 4.0.8 still depends on braces ^3.0.3. A simple compatible version bump does not remove this path today.
- In the installed and stable plugin source, fast-glob is used only by `dist/utils/get-root-dirs.js` to expand `settings.next.rootDir`, with directory-only matching. `no-html-link-for-pages` consumes that helper. The repository's current flat config does not set a custom next.rootDir, so the default path uses context.cwd; the installed dependency nevertheless remains in the audited graph.
- The audit-suggested official plugin/config 14.2.35 uses glob 10.3.10 instead. It has an older config/export shape and lacks `no-location-assign-relative-destination`, which currently produces real warnings. Blind downgrade or removing the rule/config would lose coverage and was not applied.

**Proposed, not implemented:** retain the current plugin version, rule exports, recommended/core-web-vitals configuration and all React/TypeScript/a11y rules; prepare a repository-owned immutable package derived from the exact official MIT-licensed source, changing only root-directory matching and package dependencies to remove fast-glob/micromatch/braces from the Web closure. Evaluate Node 24's [native fs.globSync](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsglobsyncpattern-options) with directory filtering, or a separately audited compatible matcher. Keep explicit source/tarball digests, license, minimal patch and reproducible packaging. This requires approval of local package maintenance and glob-semantics scope before changing the application's dependency graph.

Acceptance for that proposal: default/string/array roots; Windows separators and absolute/relative paths; directory/file filtering, hidden paths, braces, empty matches and symlink behavior; unchanged exported rule/config sets; identical ESLint findings on this source; clean selected install/SBOM/audit and existing release-scope verifier; full lint/typecheck/unit/build and fresh CI. If Native lock entries still affect audit output, diagnose and preserve the existing actual-scope/exclusion proof rather than suppress findings or weaken the gate. No zero-audit outcome is promised until measured. No exception extension is granted.

## Remaining minimum decisions

1. Review the local commits and choose whether to authorize the narrowly scoped lint-helper/package replacement proposal. No existing compatible upstream bump has yet removed the chain; a replacement is an engineering option, not evidence of an impossible dependency fix.
2. Keep full-suite/fresh-hosted gates open. Any push/dispatch still requires the parent's confirmation and an explicit resource/cost window where relevant. Local rechecks do not replace same-SHA hosted validation.
3. DR still had an enabled 124-table replication subscription at the prior read-only snapshot. Backup/PITR recovery points and restore proof were not exposed by the connected project metadata; they remain unverified and require authorized Dashboard/Management API evidence. Do not detach replication, write fixtures, reset data or repurpose a test receipt as DR schema Apply proof. The conversion/recovery decision from the release contract remains required.
