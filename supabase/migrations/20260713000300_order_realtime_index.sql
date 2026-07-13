create index if not exists order_events_stall_id_created_at_idx
on public.order_events (stall_id, created_at desc);
