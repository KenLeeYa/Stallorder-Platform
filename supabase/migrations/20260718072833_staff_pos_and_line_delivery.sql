-- Add delivery as a first-class fulfillment mode in its own migration so the
-- enum value is committed before later functions and constraints reference it.
alter type public.fulfillment_type add value if not exists 'DELIVERY';
