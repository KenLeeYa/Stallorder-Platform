-- Persist normalized table positions for merchant floor planning and staff mobile views.
alter table public.dining_tables
  add column if not exists layout_x smallint not null default 60,
  add column if not exists layout_y smallint not null default 80;

alter table public.dining_tables
  drop constraint if exists dining_tables_layout_position_check;
alter table public.dining_tables
  add constraint dining_tables_layout_position_check check (
    layout_x between 0 and 820
    and layout_y between 0 and 820
  );
