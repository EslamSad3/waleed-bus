-- Bus vehicle image storage (spec 007 follow-up).
-- Public-read bucket; writes go through the API with the service_role key
-- (service_role bypasses RLS). No authenticated-user write policies on
-- purpose: uploads are authorized by fleet/bus permissions in the API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bus-images',
  'bus-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bus-images public read" on storage.objects;
create policy "bus-images public read"
  on storage.objects for select
  using (bucket_id = 'bus-images');
