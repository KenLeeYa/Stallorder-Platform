alter table public.stall_ordering_settings
  add column if not exists preorder_reminder_minutes smallint not null default 30,
  add column if not exists manager_authorization_code_hash text,
  add column if not exists manager_authorization_code_updated_at timestamptz;

alter table public.stall_ordering_settings
  drop constraint if exists stall_ordering_settings_preorder_reminder_minutes_check;

alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_preorder_reminder_minutes_check
  check (preorder_reminder_minutes between 0 and 1440);

alter table public.printers
  add column if not exists auto_detect_enabled boolean not null default true,
  add column if not exists open_cash_drawer_on_cash_payment boolean not null default false;

alter table public.print_rules
  add column if not exists show_customer_name boolean not null default true,
  add column if not exists show_customer_phone boolean not null default true,
  add column if not exists show_delivery_address boolean not null default true,
  add column if not exists show_order_note boolean not null default true,
  add column if not exists show_item_notes boolean not null default true,
  add column if not exists show_prices boolean not null default true,
  add column if not exists show_payment_method boolean not null default true,
  add column if not exists feed_lines smallint not null default 2;

alter table public.print_rules
  drop constraint if exists print_rules_feed_lines_check;

alter table public.print_rules
  add constraint print_rules_feed_lines_check
  check (feed_lines between 1 and 3);
