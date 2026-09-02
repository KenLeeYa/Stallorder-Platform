alter table public.stalls
  add column if not exists location_guide_image_position_x smallint not null default 50,
  add column if not exists location_guide_image_position_y smallint not null default 50,
  add column if not exists location_guide_image_zoom smallint not null default 100;

alter table public.stalls
  add constraint stalls_location_guide_image_framing_check check (
    location_guide_image_position_x between 0 and 100
    and location_guide_image_position_y between 0 and 100
    and location_guide_image_zoom between 100 and 200
  );

comment on column public.stalls.location_guide_image_position_x is
  'Horizontal focus percentage used when the public location guide image is cropped.';
comment on column public.stalls.location_guide_image_position_y is
  'Vertical focus percentage used when the public location guide image is cropped.';
comment on column public.stalls.location_guide_image_zoom is
  'Public location guide image zoom percentage, constrained to 100 through 200.';
