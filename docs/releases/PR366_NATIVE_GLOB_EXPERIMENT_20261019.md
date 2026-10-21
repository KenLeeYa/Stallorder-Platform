# PR366 native glob experiment: rejected before dependency changes

Status: **INCOMPATIBLE_DO_NOT_APPLY**. The owner approved a local experiment on
2026-10-19, with an explicit stop condition if matching behavior was incompatible.
The preserved application/dependency baseline is
`cdd70822c0b360391cc91d70c43e91ff186ef99e`. No vendor package, override, lockfile
change, install script or license derivative has been applied to this repository.

## Measured result

Node `24.18.0` / npm `11.16.0` were available. In a separate scratch directory,
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` accepted
an override scoped to `eslint-config-next@16.3.6` that resolves its
`@next/eslint-plugin-next` dependency to a local official tarball. This proves
resolution only: the tarball was unmodified, no derivative version was installed,
and no reproducibility or clean-install claim is made for a vendor package.

The official source was
`https://registry.npmjs.org/@next/eslint-plugin-next/-/eslint-plugin-next-16.3.6.tgz`.
Its bytes matched the existing lock integrity:

```text
sha512-jowwDX+7DOlDIjJLgTMxudw+k37QnWu1JkZLkSi9MaJBfDYcfhAPMKBhXL0idYzFN/AGg//axnOR4cLkHX/Rng==
```

The installed `dist/utils/get-root-dirs.js` compared byte-for-byte with the
official tarball; SHA-256 is
`886677432990a735e5ebdfb345ff1cbd40e264f9947a8432eeeb254b3a926bde`.
The upstream declares MIT. No upstream code or tarball is redistributed by this
change, so no vendored LICENSE/PROVENANCE is presented as completed.

The reproducible probe invokes the actual official `getRootDirs` and compares
it with `fs.globSync + statSync directory filtering + slash normalization`.
On Windows, 11 of 19 pattern results matched exactly; eight differed. Some are
ordering or literal-path differences, but these are material result-set changes:

| Pattern | Official helper | Native candidate |
| --- | --- | --- |
| `**` | Includes `linked/pages` through a directory junction | Omits `linked/pages`, adds `.` |
| `apps/!(alpha)` | Includes `apps/.hidden` and `apps/beta` | Omits `apps/.hidden` |
| `apps/**` | Descendants only | Adds `apps` itself |
| `.` | `['.']` | `[]` |

Sorting cannot repair missing/extra roots. These synthetic fixtures do not prove
that the repository's current default-root lint configuration is affected; they
do disprove general equivalence of this direct replacement. A broader adapter or
different dependency strategy needs a revised scope and further testing. No claim
is made that every possible native implementation is impossible.

## Reproduce and interpret

From the repository, with the baseline Web install and permission to create an
owned temporary directory junction:

```powershell
node scripts/probe-next-eslint-native-glob.mjs --output native-glob-result.json
```

Expected exit is **1**, with `INCOMPATIBLE_DO_NOT_APPLY`. This is an opt-in
experiment, not an automatic test-suite input or a release gate. It verifies the
reviewed runtime/plugin/helper identity, uses only its own temporary fixture and
removes that fixture in `finally`. Fixture-creation errors are errors, not skips
or compatibility passes. The recorded result is in
`PR366_NATIVE_GLOB_EXPERIMENT_20261019.json`.

## Verification and remaining gates

- Before changes, full ESLint baseline: 2,292 files, 0 errors, 27 warnings.
- Probe against the actual official helper: expected exit 1, 19 cases, 11 exact
  matches; evidence records all outputs and source hashes.
- Probe-specific lint and `git diff --check`: passed.
- Final full ESLint: 2,293 files, 0 errors, 27 warnings; normalized diagnostics
  are identical to the pre-experiment baseline. Production guardrails passed
  (3,254 inputs / 173 migrations, existing reviewed migration warning retained).
- Selected official-registry Web audit repeated after the rejection: **5 HIGH
  remain; zero advisory entries eliminated**. The path remains
  `eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces`.
  The expired exception is unchanged.
- Parent-authorized independent review confirmed that the set differences justify
  stopping. Review was read-only and did not independently rerun the junction
  fixture or authenticate registry publication; local integrity was checked above.
- No new candidate clean install/SBOM, downstream rule comparison, all-rules/export
  comparison, full Web rerun or build is claimed: the replacement was rejected
  before those acceptance stages. The previous complete Web result on `cdd70822`
  remains historical evidence (727 files, 4,738 passed, 108 existing skips).

This change retains only the probe, its sanitized evidence and this decision
record. There was no push, dispatch, deployment, DR action, Docker startup or paid
resource creation. Next decision: approve a separately specified compatible
adapter/alternative, or wait for a verified upstream fix; do not extend the audit
exception or remove lint coverage to force a pass.
