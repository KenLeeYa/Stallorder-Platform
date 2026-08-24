import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertPaygContractIntegrity } from "../src/server/billing/payg-contract";

const prisma = new PrismaClient();
const migration = "20260824110000";

async function main() {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const migrationRows = await prisma.$queryRaw<Array<{ present: boolean }>>`
    select exists (
      select 1 from supabase_migrations.schema_migrations where version = ${migration}
    ) as present
  `;
  push("schema.migration", Boolean(migrationRows[0]?.present), migrationRows[0]?.present ? migration : `${migration} missing`);

  const schemaRows = await prisma.$queryRaw<Array<{ required_columns: number; rls_tables: number }>>`
    select
      (select count(*)::integer from information_schema.columns
       where table_schema = 'public' and (
         (table_name = 'plan_versions' and column_name in ('billing_timezone','tax_treatment','sealed_at','contract_hash'))
         or (table_name = 'subscriptions' and column_name = 'billing_timezone')
         or (table_name = 'auth_sessions' and column_name = 'device_label')
       )) as required_columns,
      (select count(*)::integer from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'public' and relation.relname in ('billing_credit_adjustments','payg_close_jobs')
         and relation.relrowsecurity and relation.relforcerowsecurity) as rls_tables
  `;
  push("schema.columns", schemaRows[0]?.required_columns === 6, `${schemaRows[0]?.required_columns ?? 0}/6`);
  push("schema.rls", schemaRows[0]?.rls_tables === 2, `${schemaRows[0]?.rls_tables ?? 0}/2`);

  const versions = await prisma.planVersion.findMany({
    where: { plan: { code: "PAYG", isActive: true }, pricingMode: "USAGE_PER_STALL_CAPPED" },
    include: { entitlements: true },
    orderBy: { version: "desc" },
  });
  const active = versions.find((version) => version.isPublic && version.effectiveFrom <= new Date() && (!version.effectiveUntil || version.effectiveUntil > new Date()));
  push("contract.active", Boolean(active), active ? `v${active.version}` : "missing");
  let contractOk = false;
  if (active) {
    try {
      assertPaygContractIntegrity(active);
      contractOk = active.currency === "TWD" && active.usageUnitPrice === 1 && active.monthlyCapAmount === 1499;
      push("contract.integrity", contractOk, contractOk ? active.contractHash! : "price/cap/currency mismatch");
    } catch (error) {
      push("contract.integrity", false, error instanceof Error ? error.message : "invalid");
    }
  } else {
    push("contract.integrity", false, "no active PAYG contract");
  }

  const [subscriptionRows, ledgerRows, invoiceRows, creditRows, flagRows] = await Promise.all([
    prisma.$queryRaw<Array<{ invalid: number }>>`
      select count(*)::integer as invalid
      from public.subscriptions subscription
      join public.plans plan on plan.id = subscription.plan_id
      left join public.plan_versions version on version.id = subscription.plan_version_id
      where plan.code = 'PAYG' and (
        version.id is null or version.plan_id <> subscription.plan_id or version.sealed_at is null
        or subscription.billing_timezone is distinct from version.billing_timezone
      )
    `,
    prisma.$queryRaw<Array<{ duplicate_completion: number; duplicate_refund: number; orphan_refund: number; period_anomaly: number }>>`
      select
        (select count(*)::integer from (
          select reference_id from public.usage_events where event_type = 'BILLABLE_ORDER_COMPLETED' group by reference_id having count(*) > 1
        ) duplicate) as duplicate_completion,
        (select count(*)::integer from (
          select reference_id from public.usage_events where event_type = 'BILLABLE_ORDER_FULL_REFUND' group by reference_id having count(*) > 1
        ) duplicate) as duplicate_refund,
        (select count(*)::integer from public.usage_events refund where refund.event_type = 'BILLABLE_ORDER_FULL_REFUND'
          and not exists (select 1 from public.usage_events completion where completion.event_type = 'BILLABLE_ORDER_COMPLETED' and completion.reference_id = refund.reference_id)) as orphan_refund,
        (select count(*)::integer from public.usage_events event join public.subscriptions subscription on subscription.organization_id = event.organization_id
          where event.event_type in ('BILLABLE_ORDER_COMPLETED','BILLABLE_ORDER_FULL_REFUND')
            and event.billing_period <> date_trunc('month', event.occurred_at at time zone subscription.billing_timezone)::date) as period_anomaly
    `,
    prisma.$queryRaw<Array<{ arithmetic_mismatch: number; snapshot_missing: number }>>`
      select
        count(*) filter (where subtotal + tax_amount - discount_amount <> total_amount or total_amount - amount_paid <> amount_due)::integer as arithmetic_mismatch,
        count(*) filter (where pricing_mode = 'USAGE_PER_STALL_CAPPED' and (
          pricing_snapshot_json ->> 'contractHash' is null or pricing_snapshot_json ->> 'taxTreatment' is null
        ))::integer as snapshot_missing
      from public.invoices
    `,
    prisma.$queryRaw<Array<{ unapplied: number; duplicate_refunds: number }>>`
      select
        count(*) filter (where status = 'UNAPPLIED')::integer as unapplied,
        (select count(*)::integer from (
          select refund_usage_event_id from public.billing_credit_adjustments group by refund_usage_event_id having count(*) > 1
        ) duplicate) as duplicate_refunds
      from public.billing_credit_adjustments
    `,
    prisma.billingFeatureFlag.findMany({
      where: { code: { in: ["OPEN_BETA_FREE_ACCESS_ENABLED", "PAYG_BILLING_ENABLED", "PAYG_REFUND_CREDITS_ENABLED", "PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED"] } },
      select: { code: true, isEnabled: true },
    }),
  ]);
  push("subscriptions.contract", subscriptionRows[0]?.invalid === 0, `${subscriptionRows[0]?.invalid ?? 0} invalid`);
  const ledger = ledgerRows[0];
  push("ledger.uniqueness", Boolean(ledger) && ledger.duplicate_completion === 0 && ledger.duplicate_refund === 0 && ledger.orphan_refund === 0, JSON.stringify(ledger));
  push("ledger.timezone", ledger?.period_anomaly === 0, `${ledger?.period_anomaly ?? 0} anomalies`);
  const invoices = invoiceRows[0];
  push("invoice.arithmetic", invoices?.arithmetic_mismatch === 0, `${invoices?.arithmetic_mismatch ?? 0} mismatches`);
  push("invoice.snapshot", invoices?.snapshot_missing === 0, `${invoices?.snapshot_missing ?? 0} missing`);
  const credits = creditRows[0];
  push("credits.uniqueness", credits?.duplicate_refunds === 0, `${credits?.duplicate_refunds ?? 0} duplicates; ${credits?.unapplied ?? 0} unapplied`);

  const vercel = JSON.parse(await readFile(resolve("vercel.json"), "utf8")) as { crons?: Array<{ path: string }> };
  push("scheduler.registered", Boolean(vercel.crons?.some((cron) => cron.path === "/api/cron/payg-close")), "/api/cron/payg-close");
  push("rollout.flags", true, flagRows.map((flag) => `${flag.code}=${flag.isEnabled ? "ON" : "OFF"}`).join(", "));

  const blocking = checks.some((check) => !check.ok);
  const flags = new Map(flagRows.map((flag) => [flag.code, flag.isEnabled]));
  const readiness = blocking
    ? "NOT_READY"
    : flags.get("PAYG_AUTOMATIC_INVOICE_CLOSE_ENABLED")
      ? "READY_FOR_AUTOMATIC_CLOSE_PILOT"
      : flags.get("PAYG_BILLING_ENABLED")
        ? "READY_FOR_MANUAL_PILOT"
        : "READY_FOR_STAGING";
  const report = { generatedAt: new Date().toISOString(), readOnly: true, readiness, checks };
  const format = process.argv.find((argument) => argument.startsWith("--format="))?.split("=", 2)[1] ?? "both";
  if (format === "json" || format === "both") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (format === "markdown" || format === "both") {
    process.stdout.write(`\n# PAYG production audit\n\n- Result: **${readiness}**\n- Read-only: yes\n\n| Check | Result | Detail |\n|---|---|---|\n`);
    for (const check of checks) process.stdout.write(`| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${check.detail.replaceAll("|", "\\|")} |\n`);
  }
  if (readiness === "NOT_READY") process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`PAYG_PRODUCTION_AUDIT_FAILED ${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
}).finally(() => prisma.$disconnect());
