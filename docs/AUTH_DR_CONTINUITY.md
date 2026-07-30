# Auth DR Continuity

Supabase Auth user IDs are project-specific. `profiles.auth_user_id` remains the
legacy Primary identity. `profile_auth_identities` maps a Profile to a verified
Google identity for each Auth project.

The Primary-to-DR publication excludes only `profiles.auth_user_id`. The DR
subscriber therefore keeps that column null and resolves authenticated users
through `profile_auth_identities`; all other Profile fields continue to
replicate. Authorization helpers reject an Auth user ID if it maps to more than
one Profile.

## Normal Primary login

The existing conflict and password-linking behavior remains unchanged. A
successful verified Google callback also upserts the `PRIMARY` identity mapping.

## DR login

With `AUTH_PROJECT_CODE=DR`:

1. DR Supabase Auth validates Google and confirms the Email.
2. The application looks up the DR Auth identity mapping.
3. If no mapping exists, the exact normalized verified Email may resolve an
   existing Profile.
4. The DR identity is linked transactionally.
5. Conflicting identity and Email matches are rejected.
6. No duplicate Organization is created.

Users may need to sign in again after promotion. Existing online Supabase
sessions are not promised to survive a project switch. A valid Offline POS
permit continues only until its signed expiry and may still be revoked during
synchronization.

Google OAuth must contain reviewed callback URLs for both Supabase projects and
the stable application callback. Provider secrets are configured independently
in each project and are never copied through PostgreSQL.
