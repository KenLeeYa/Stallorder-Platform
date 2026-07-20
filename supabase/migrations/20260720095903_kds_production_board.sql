-- Keep the existing WAITING_CONFIRMATION value for backward compatibility.
-- PACKING is additive and allows an explicit packaging stage in KDS.
alter type public.order_status add value if not exists 'PACKING' before 'READY';
