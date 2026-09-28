-- Additive recovery scheduling; a worker never repeats a monetary mutation.
alter table public.line_platform_payment_attempts
  add column next_recovery_at timestamptz not null default (now()+interval '1 minute'),
  add column recovery_attempts integer not null default 0 check (recovery_attempts>=0),
  add column recovery_fence uuid,
  add column recovery_lease_until timestamptz,
  add column recovery_manual_review boolean not null default false;
create index line_platform_payment_due_recovery
  on public.line_platform_payment_attempts(environment,next_recovery_at)
  where not recovery_manual_review;
