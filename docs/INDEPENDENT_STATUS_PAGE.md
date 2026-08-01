# Independent Status Page

## Architecture

`status.qidaigo.com` is served by the `stallorder-status` Cloudflare Worker. It
does not depend on the StallOrder Vercel deployment or either Supabase project
to render a response.

The Worker performs a bounded, three-second probe of the public Production
health endpoint and publishes only:

- QR ordering status;
- staff and kitchen ordering status;
- payment and checkout status;
- a public incident summary; and
- a customer workaround.

It never publishes project references, database endpoints, replication state,
security events, credentials, customer records or internal recovery commands.
The HTML is self-contained, uses no third-party scripts, refreshes every 60
seconds and applies a restrictive CSP and browser security headers.

## Protected deployment

Use `.github/workflows/status-page-deploy.yml` from the verified `main` branch.
The workflow accepts:

| Operation | Confirmation | Writes |
| --- | --- | --- |
| `plan` | `PLAN_STATUS_PAGE` | None |
| `deploy` | `DEPLOY_STATUS_PAGE` | Worker code, custom domain DNS and certificate |

Both operations first:

1. verify that `main` has the exact `staging` tree;
2. build the Worker without publishing;
3. verify Cloudflare account and zone access;
4. stop on an existing DNS or Worker-domain conflict; and
5. upload `status-page-deployment-plan.json`.

The deployment uses a Worker Custom Domain. Cloudflare creates the DNS record
and certificate; no Vercel DNS target is used for this hostname.

Required GitHub `production` environment configuration:

- secret `CLOUDFLARE_API_TOKEN`;
- variable `CLOUDFLARE_ACCOUNT_ID`; and
- variable `CLOUDFLARE_ZONE_ID`.

The token should be scoped to this account and the `qidaigo.com` zone with only
Workers Scripts write/read, Workers Routes write/read and DNS read permissions
needed by the plan and deployment. The preflight accepts either an account-owned
or user-owned API token and validates it through the corresponding Cloudflare
verification endpoint before any write operation.

## Incident updates

The public defaults live in `status-worker/wrangler.jsonc`:

- `INCIDENT_STATUS` accepts `OPERATIONAL`, `DEGRADED`, `OUTAGE` or
  `MAINTENANCE`;
- `INCIDENT_SUMMARY` is customer-facing and must contain no sensitive detail;
- `INCIDENT_WORKAROUND` describes the safe customer action; and
- `PAYMENT_STATUS` controls the high-level checkout status.

An incident update follows the normal Staging-first release policy. For an
urgent update, change only these public values, review the diff, deploy through
the protected workflow and preserve the incident record.

## Verification

After deployment the workflow verifies:

- `https://status.qidaigo.com/health` returns `ok` over HTTPS;
- `/api/status` contains all three required service codes and reports the
  overall status and every service as `OPERATIONAL`;
- HSTS is present; and
- CSP is present.

The Worker deliberately returns a degraded status page when the Production
health probe times out, redirects or returns an invalid response. A failed
primary probe must not make the independent status page unavailable.

## Rollback

For a code regression, redeploy the previous verified Worker version while
keeping the custom domain attached.

For complete removal:

1. detach `status.qidaigo.com` from `stallorder-status`;
2. verify the hostname no longer routes to the Worker;
3. delete the Worker only after detachment; and
4. separately review the generated certificate because deleting a Custom
   Domain does not automatically delete its certificate.

Do not replace the custom domain with a Vercel CNAME during an incident. That
would remove the independence this service is intended to provide.
