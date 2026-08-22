-- The routing definition is consolidated into 20260822010000 because both
-- migrations are pending together in protected Production and DR.
create unique index if not exists print_jobs_order_rule_unique
  on public.print_jobs (order_id, print_rule_id)
  where print_rule_id is not null
    and (reprint_of_id is null or is_routing_copy);
