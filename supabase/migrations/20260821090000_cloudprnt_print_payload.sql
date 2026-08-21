alter table public.print_jobs
  add column if not exists payload jsonb;

comment on column public.print_jobs.payload is
  'Immutable printer-ready payload used for idempotent CloudPRNT GET retries.';
