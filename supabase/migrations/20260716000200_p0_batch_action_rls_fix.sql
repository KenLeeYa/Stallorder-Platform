-- Preserve the platform-wide invariant that browser roles are read-only and
-- every exposed table enforces RLS even for its owner.
alter table public.order_item_batch_actions enable row level security;
alter table public.order_item_batch_actions force row level security;
revoke all on table public.order_item_batch_actions from public, anon, authenticated;
grant select on table public.order_item_batch_actions to authenticated;
