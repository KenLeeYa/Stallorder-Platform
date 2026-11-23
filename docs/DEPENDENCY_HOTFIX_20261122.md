# Next.js, Undici and Zod dependency hotfix

This candidate starts at Production `4e95d2ea`. It takes the reviewed dependency hunks from `e29b38ee` and `b6e558fd`. Next.js and its matching ESLint configuration move to 16.4.6, Undici to 7.30.1, and Zod to 4.6.6. A fresh npm audit identified a remaining Next.js advisory through 16.4.4, so this candidate uses 16.4.6 and the matching lint configuration. The Vercel CLI configuration resolves the same Zod version through an npm override.

A scoped npm override upgrades the Effect dependency of `@prisma/config` from 3.21.0 to 3.22.5 for GHSA-7589-6fvf-x4pw. Prisma CLI, Client, and Config stay at 6.19.3. The lockfile and dependency contract test ensure Prisma resolves the reviewed Effect release.

The 16 remaining npm audit entries came from two development dependency paths. The ESLint and Next ESLint package tree had 14 entries rooted in Minimatch, including the inherited entries for config-array, eslintrc, import, JSX accessibility, React and typescript-eslint. Vitest and its mocker accounted for the remaining two entries.

Upgrade the existing Minimatch override to 11.0.1 and Vitest to 4.1.12, including its version-matched internal packages. Keep the previous ESLint and Next versions and preserve the existing audit threshold. ESLint configuration loading and the full lint run exercise the Minimatch consumers under the repository’s Node.js 24 runtime.

Validate a clean lockfile install, the dependency contract and ordinary CI, then verify the paired isolated Preview and its synthetic critical paths. Production publication is outside this change.

## Protected integration qualification

For PR #413 and its bounded staging-to-main promotion, validate the checked-out merge tree against the admitted base, exact head tree, and reviewed integration ancestry. Provision a data-less child with a run-specific identity after the Preview environment review. Check the child’s project, parent, Git branch, and connection targets before running any fixture or Edge writes. Match the Vercel project, Preview target, revision and run metadata before hosted smoke. Remove only the paired resources owned by the run and verify cleanup. The existing delivery candidate continues using its reserved branch and frozen product.

The hosted database-principal check uses the dedicated child recorded by the admitted run. Delivery qualification still uses its fixed child. The check verifies the deployed revision and retains the anonymous, non-admin and revoked-session denials.
