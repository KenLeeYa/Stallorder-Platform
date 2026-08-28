import "server-only";

import { Prisma } from "@prisma/client";
import { logEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

const REFRESH_INTERVAL_MS = 5 * 60_000;
const STALE_CLAIM_MS = 10 * 60_000;

export async function processDueOperationalAlertRefreshes(limit = 10) {
  const boundedLimit = Math.max(1, Math.min(limit, 25));
  await prisma.$executeRaw`
    insert into public.operational_alert_refresh_states (organization_id)
    select organization.id
    from public.organizations organization
    where organization.status in (
      'TRIALING'::public.tenant_status,
      'ACTIVE'::public.tenant_status,
      'PAST_DUE'::public.tenant_status,
      'GRACE_PERIOD'::public.tenant_status
    )
      and exists (
        select 1 from public.stalls stall
        where stall.organization_id = organization.id and stall.is_active
      )
      and not exists (
        select 1 from public.operational_alert_refresh_states state
        where state.organization_id = organization.id
      )
    order by organization.created_at asc
    limit 100
    on conflict (organization_id) do nothing
  `;

  const now = new Date();
  const refreshBefore = new Date(now.getTime() - REFRESH_INTERVAL_MS);
  const staleClaimBefore = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimed = await prisma.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
    with candidates as (
      select state.organization_id
      from public.operational_alert_refresh_states state
      join public.organizations organization on organization.id = state.organization_id
      where organization.status in (
        'TRIALING'::public.tenant_status,
        'ACTIVE'::public.tenant_status,
        'PAST_DUE'::public.tenant_status,
        'GRACE_PERIOD'::public.tenant_status
      )
        and (state.last_refreshed_at is null or state.last_refreshed_at <= ${refreshBefore})
        and (state.claimed_at is null or state.claimed_at <= ${staleClaimBefore})
      order by state.last_refreshed_at asc nulls first, state.created_at asc
      for update of state skip locked
      limit ${boundedLimit}
    )
    update public.operational_alert_refresh_states state
    set claimed_at = ${now}, last_error_code = null, updated_at = ${now}
    from candidates
    where state.organization_id = candidates.organization_id
    returning state.organization_id as "organizationId"
  `);

  let refreshed = 0;
  let failed = 0;
  for (const claim of claimed) {
    try {
      await prisma.$queryRaw`
        select public.refresh_operational_alerts_bounded(${claim.organizationId}::uuid)
      `;
      await prisma.operationalAlertRefreshState.update({
        where: { organizationId: claim.organizationId },
        data: {
          lastRefreshedAt: new Date(),
          claimedAt: null,
          lastErrorCode: null,
        },
      });
      refreshed += 1;
    } catch {
      await prisma.operationalAlertRefreshState.update({
        where: { organizationId: claim.organizationId },
        data: {
          claimedAt: null,
          lastErrorCode: "REFRESH_FAILED",
        },
      });
      failed += 1;
      logEvent("warn", "OPERATIONAL_ALERT_BACKGROUND_REFRESH_FAILED", {
        organizationId: claim.organizationId,
      });
    }
  }

  return { claimed: claimed.length, refreshed, failed };
}
