-- Blue Render — private Storage bucket for Planta Humanizada files
-- Objects live at "<user_id>/<generation_id>/<original|style-reference|result>.<ext>".
-- The bucket is PRIVATE: nothing is reachable by a public URL. The backend
-- (service_role) is the only writer and hands the browser short-lived signed
-- URLs after an ownership check. The read policy below additionally lets a
-- signed-in user read only objects under their own <user_id>/ folder.
-- Idempotent: safe to re-run (also safe if the bucket was created earlier
-- through the Storage API).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'humanized-floorplans',
  'humanized-floorplans',
  false,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "humanized_floorplans_storage_select_own" on storage.objects;
create policy "humanized_floorplans_storage_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'humanized-floorplans'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
