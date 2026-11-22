# Next.js, Undici and Zod dependency hotfix

This candidate starts at Production `4e95d2ea`. It takes the reviewed dependency hunks from `e29b38ee` and `b6e558fd`. Next.js and its matching ESLint configuration move to 16.4.6, Undici to 7.30.1, and Zod to 4.6.6. A fresh npm audit identified a remaining Next.js advisory through 16.4.4, so this candidate uses 16.4.6 and the matching lint configuration. The Vercel CLI configuration resolves the same Zod version through an npm override.

Validate a clean lockfile install, the dependency contract and ordinary CI, then verify the paired isolated Preview and its synthetic critical paths. Production publication is outside this change.
