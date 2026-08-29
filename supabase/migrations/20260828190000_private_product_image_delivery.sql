-- Product images are delivered only through the application proxy so deletion
-- tombstones and active Primary/DR routing cannot be bypassed with a direct URL.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '2min';

update storage.buckets
set public = false
where id = 'product-images';

-- These existing tables are fenced on a sealed DR backend. Hold exclusive
-- table locks inside this transaction while the reviewed data rewrite runs,
-- then restore both guards before commit.
alter table public.products disable trigger backend_writable_guard;
alter table public.stalls disable trigger backend_writable_guard;

update public.products
set image_url = regexp_replace(
  image_url,
  '^https?://[^/]+/storage/v1/object/public/product-images/',
  '/api/assets/product-images/',
  'i'
)
where image_url ~* '^https?://[^/]+/storage/v1/object/public/product-images/';

update public.stalls
set cover_image_url = regexp_replace(
  cover_image_url,
  '^https?://[^/]+/storage/v1/object/public/product-images/',
  '/api/assets/product-images/',
  'i'
)
where cover_image_url ~* '^https?://[^/]+/storage/v1/object/public/product-images/';

update public.stalls
set location_guide_image_url = regexp_replace(
  location_guide_image_url,
  '^https?://[^/]+/storage/v1/object/public/product-images/',
  '/api/assets/product-images/',
  'i'
)
where location_guide_image_url ~* '^https?://[^/]+/storage/v1/object/public/product-images/';

alter table public.products enable trigger backend_writable_guard;
alter table public.stalls enable trigger backend_writable_guard;

commit;
