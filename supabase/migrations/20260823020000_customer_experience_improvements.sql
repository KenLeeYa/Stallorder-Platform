alter table public.stalls
  add column if not exists cover_image_position_x smallint not null default 50,
  add column if not exists cover_image_position_y smallint not null default 50,
  add column if not exists cover_image_zoom smallint not null default 100;

alter table public.stalls
  add constraint stalls_cover_image_position_x_check check (cover_image_position_x between 0 and 100),
  add constraint stalls_cover_image_position_y_check check (cover_image_position_y between 0 and 100),
  add constraint stalls_cover_image_zoom_check check (cover_image_zoom between 100 and 200);

alter table public.stall_ordering_settings
  add column if not exists order_alert_sound_preset text not null default 'URGENT',
  add column if not exists order_alert_sound_object_path text,
  add column if not exists order_alert_volume smallint not null default 100,
  add column if not exists order_alert_repeat_count smallint not null default 2;

alter table public.stall_ordering_settings
  add constraint stall_ordering_settings_order_alert_sound_preset_check
    check (order_alert_sound_preset in ('URGENT', 'BELL', 'CHIME', 'CUSTOM')),
  add constraint stall_ordering_settings_order_alert_volume_check
    check (order_alert_volume between 10 and 100),
  add constraint stall_ordering_settings_order_alert_repeat_count_check
    check (order_alert_repeat_count between 1 and 3);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'alert-sounds',
  'alert-sounds',
  false,
  1048576,
  array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a']
)
on conflict (id) do nothing;
