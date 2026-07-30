alter type public.payment_status
  add value if not exists 'PENDING_RECONCILIATION';
