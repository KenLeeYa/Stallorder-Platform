-- Keep existing merchant configuration unchanged while reducing defaults for new stalls.
alter table public.stall_ordering_settings
  alter column dine_in_enabled set default false,
  alter column enabled_locales set default array['zh-TW']::text[];
