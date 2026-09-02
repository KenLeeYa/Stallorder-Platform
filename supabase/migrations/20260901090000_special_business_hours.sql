alter table public.stall_special_closures
  add column if not exists opens_at text,
  add column if not exists closes_at text;

alter table public.stall_special_closures
  add constraint stall_special_closures_open_window_check
  check (
    (opens_at is null and closes_at is null)
    or (
      opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and opens_at < closes_at
    )
  );
