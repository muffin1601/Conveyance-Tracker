-- ============================================================
-- Watcon Conveyance Tracker — Bill attachments storage bucket
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================
-- OPTIONAL: the app auto-creates this bucket on the first upload
-- (once SUPABASE_SERVICE_ROLE_KEY is set). Run this only if you
-- prefer to provision it manually.
--
-- The bucket is PRIVATE on purpose. Do NOT add anon/authenticated
-- Storage policies: the default-deny is what keeps bills private.
-- All access is brokered by the app server via the service_role key
-- (signed upload + signed download URLs). This app has no Supabase
-- Auth, so per-user RLS on auth.uid() does not apply here.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-bills',
  'expense-bills',
  false,                       -- private: no public/anonymous access
  10485760,                    -- 10 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Verify:
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'expense-bills';
