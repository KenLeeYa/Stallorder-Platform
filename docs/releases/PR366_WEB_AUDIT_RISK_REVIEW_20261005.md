# PR366 Web audit risk review — 2026-10-05

## Decision status

Review completed. The prior `WEB-20261003-BRACES-USER-ACCEPTED` exception expired at 2026-10-04 16:00 UTC. The user subsequently approved a **new** exact Web development-dependency risk exception through 2026-10-06 08:00 UTC after this review was presented, and separately approved one paid Preview pair for 2026-10-05 08:00–11:00 UTC with a US$2 operational stop target that is not a provider billing guarantee. The prior CI pass is not fresh evidence. `assertRootAudit` rejected the expired exception on the 2026-10-05 `6d09af0a` Web Install Scope Proof run; CI `verify` and Web Install Scope Proof must pass afresh on the new policy head. The new policy ID is `WEB-20261005-BRACES-USER-ACCEPTED`; raw audit remains `NON_PASS` and the exception is limited to the exact reviewed graph.

## Exact reviewed dependency

- PR head at review: `c31c84a483993b724952d9e6c56d8c028eb31369`.
- `package-lock.json` SHA-256 of raw file bytes: `f68c4c5bd060708f5e55ee6d212de84781bf6da576a5ba6ed7ec3fc38e580626`. The policy's `JSON.stringify(parsedLock)` SHA-256 is `ff74a3a96c79d6deaabc94f36b7a3bfb45022d9d585e328ed6b3ee7d50d3f228`.
- Web root development dependency path: `eslint-config-next@16.3.6` → `@next/eslint-plugin-next@16.3.6` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. `npm ls` shows the same Web path. Native workspace paths are a separate diagnostic and are not accepted by this Web exception.
- Advisory: `GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687`, high severity, stack exhaustion for deeply nested brace patterns. GitHub Advisory Database lists `<=3.0.3` affected and no patched version as checked 2026-10-05.
- The last accepted selected Web audit recorded five high entries, corresponding to the vulnerable package and four ancestors. New audit output must be checked before any new exception decision; the lockfile and counts must be bound again if they change.

## Exposure and limits

`@next/eslint-plugin-next` invokes `fast-glob` for Next root directory globs. The checked-in `eslint.config.mjs` uses Next's core web vitals and TypeScript rules and does not set `settings.next.rootDir` from a remote request. The reviewed path is build/lint tooling, not an identified public request handler. This lowers the demonstrated application exposure but does not prove the dependency cannot be reached in another CLI/tooling path. A malicious or compromised input to a process using `braces` can exhaust its stack and terminate that process. A compromised build input or future configuration change remains a residual risk.

Removing Next's lint configuration would remove current rules and is not an acceptable workaround. Renaming/aliasing the vulnerable package to silence `npm audit` would not repair it. No official patched version is presently available. A vetted upstream patch or source-reviewed fork with a nesting-depth guard could be considered, but would require separate provenance, behavior, lint, audit and CI review; a package-name change alone is not a clean audit.

## Controls and decision needed

Keep the selected Web audit, full-repository diagnostic, lockfile binding, source/tree hashing, Next lint, Web install-scope check and build proof. Do not turn `NON_PASS` into `PASS`; record any exception as an explicit accepted-risk decision. On each new head, rerun the selected audit and check the exact five-item graph and advisory. Stop if new vulnerabilities or a changed graph appear. Continue watching the upstream advisory and replace the exception with a fixed dependency and clean audit when possible.

The approved exception is limited to this exact Web development dependency chain, current lock hash, five high selected-audit entries, stack-exhaustion availability risk and unchanged security checks. It expires at **2026-10-06 08:00 UTC**. It does not cover Native release or new vulnerabilities; a changed dependency graph requires a new review. The release decision remains `USER_ACCEPTED_EXACT_EXCEPTION` and selected audit remains `NON_PASS` while this exception applies. The separate paid Preview approval does not waive required deployment or release gates.

## 2026-10-06 patched transitive dependency follow-up

At PR366 head `fadeaf4c`, the selected Web audit reported a sixth high item: `source-map-js@1.2.1`, advisory `GHSA-68fv-2mgg-jv7q`. The existing five-item exception correctly rejected it. The GitHub reviewed advisory and upstream v1.2.2 release identify `1.2.2` as patched. Both installed parents, `postcss@8.5.25` and `@tailwindcss/node@4.3.2`, accept `^1.2.1`; the minimal lockfile update changes only the `source-map-js` version, tarball URL, and integrity. After installing 1.2.2, a fresh selected Web audit again reported only the original five high entries with the same names and counts. The exact policy lock hash was rebound to `b1ae2a6a50aec8032c81fb6e5017300f710235712b5c3b30a4737db2b3a94d3d`, without changing the exception's advisory, packages, counts, scope, or 08:00 UTC expiry. This removes the newly reported item; it does not claim the original `braces` exception is a clean audit or extend its approval. The dependency is present through PostCSS and Tailwind build tooling; a broader runtime reachability proof was not performed.
