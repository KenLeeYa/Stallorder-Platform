-- Product images are delivered only through the application proxy so deletion
-- tombstones and active Primary/DR routing cannot be bypassed with a direct URL.
update storage.buckets
set public = false
where id = 'product-images';

drop policy if exists product_images_public_read on storage.objects;

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

comment on column public.products.image_url is
  'Product image URL; managed product-images objects must use the revocation-aware application proxy.';
