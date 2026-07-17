begin;

alter table public.notification_preferences
  drop constraint if exists notification_preferences_channel_check;

alter table public.notification_preferences
  add constraint notification_preferences_channel_check
  check (channel in ('telegram', 'max'));

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_channel_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check
  check (channel in ('telegram', 'max'));

commit;
