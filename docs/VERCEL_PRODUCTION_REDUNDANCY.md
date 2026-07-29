# Vercel Production Redundancy

The authenticated plan inspection found Vercel Pro with valid `hnd1` compute.
The requested automatic regional Function failover is not available in the
current validated configuration. `vercel.json` therefore remains single-region
Tokyo and does not contain unsupported multi-region settings.

Vercel provides CDN and platform-zone resilience, but this does not remove the
single active database dependency.

Current safeguards:

- static and cached public content at the CDN;
- Circuit A on Supabase Edge and Circuit B on Vercel;
- explicit application protocol version;
- backward-compatible migrations and client/server skew handling;
- Vercel Preview plus isolated Supabase Preview validation;
- feature flags, canary rollout and instant application rollback.

Do not add Osaka or Seoul Function regions until the plan supports the intended
failover behavior and database-latency measurements justify the change.
