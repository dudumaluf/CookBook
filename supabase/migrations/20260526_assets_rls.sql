-- Slice 6.1 — Tighten asset bucket RLS to per-user scoping (ADR-0034).
--
-- Day-1 ADR-0018b shipped permissive `anon` RLS on `cookbook-assets`:
-- anyone could SELECT / INSERT / DELETE inside the bucket. That was a
-- single-user MVP shortcut. With Supabase Auth landing in Slice 6.1, every
-- write now goes through an authenticated session, scoped to the user's own
-- folder prefix `users/<auth.uid()>/...`.
--
-- Reads stay public so existing public CDN URLs (in localStorage from
-- pre-auth uploads) continue resolving — the bucket itself is `public: true`,
-- so unauthenticated GETs work via Supabase's own public-URL mechanism
-- regardless of RLS. Keeping the anon SELECT policy is belt-and-suspenders.

-- Drop legacy anon write policies. New writes must be authenticated AND
-- target the user's own folder prefix. Leave the SELECT policy in place so
-- the catalog still resolves for ad-hoc URL viewers.
drop policy if exists cookbook_assets_anon_insert on storage.objects;
drop policy if exists cookbook_assets_anon_delete on storage.objects;

-- Authenticated INSERT: object key must start with `users/<my-uid>/`.
-- `storage.foldername(name)` returns the path segments as an array, so
-- segment 1 = "users" and segment 2 must equal `auth.uid()`.
drop policy if exists cookbook_assets_owner_insert on storage.objects;
create policy "cookbook_assets_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'cookbook-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Authenticated DELETE: same scope rule. Cleanup of own files only.
drop policy if exists cookbook_assets_owner_delete on storage.objects;
create policy "cookbook_assets_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'cookbook-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Authenticated UPDATE: future-proofing (e.g. `update_metadata`). Same scope.
drop policy if exists cookbook_assets_owner_update on storage.objects;
create policy "cookbook_assets_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'cookbook-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'cookbook-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
