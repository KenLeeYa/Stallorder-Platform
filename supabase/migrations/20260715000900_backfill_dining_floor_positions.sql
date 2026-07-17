-- Separate tables that received the same default position when floor planning was introduced.
with ranked_tables as (
  select
    id,
    row_number() over (
      partition by stall_id
      order by sort_order, created_at, id
    ) - 1 as slot
  from public.dining_tables
)
update public.dining_tables as dining_table
set
  layout_x = 60 + ((ranked.slot % 25) % 5) * 190,
  layout_y = 80 + floor((ranked.slot % 25) / 5.0)::integer * 185
from ranked_tables as ranked
where dining_table.id = ranked.id;
