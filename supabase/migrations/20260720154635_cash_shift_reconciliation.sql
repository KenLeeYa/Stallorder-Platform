-- Enum values must be committed before the core migration references them.
alter type public.cash_shift_status add value if not exists 'CLOSING';
alter type public.cash_shift_status add value if not exists 'REVIEW_REQUIRED';

alter type public.cash_movement_type add value if not exists 'OPENING_FLOAT';
alter type public.cash_movement_type add value if not exists 'CASH_SALE';
alter type public.cash_movement_type add value if not exists 'CASH_REFUND';
alter type public.cash_movement_type add value if not exists 'CORRECTION';
