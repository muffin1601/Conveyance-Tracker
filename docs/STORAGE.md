# Bill Attachments — Supabase Storage

Employees can attach a bill (receipt) to **miscellaneous expenses** and to
**conveyance legs**. Admins can **view and download** any bill but never upload.

## Why server-brokered (not client RLS)

This app has **no Supabase Auth** — identity is an app-level employee cookie and
admin is a shared PIN. Supabase Storage RLS keyed on `auth.uid()` therefore has
no authenticated user to match against. The secure equivalent here is:

- **Private bucket** `expense-bills` — no public or anonymous access at all.
  With no `anon`/`authenticated` policies, Postgres RLS **default-denies**
  every browser-side request. Only the `service_role` key (which bypasses RLS)
  can touch objects, and that key lives **only on the server**.
- **Uploads** use a one-time **signed upload URL** minted server-side and scoped
  to a server-chosen path (`<employeeCode>/<year>/<month>/<uuid>.<ext>`). The
  browser PUTs the file straight to that URL (real progress bar) with no secret.
  The path is server-controlled, so directory traversal / arbitrary keys are
  impossible.
- **Views/downloads** use short-lived **signed download URLs** (1 hour) minted
  server-side on demand — nothing is exposed at rest.
- **Authorization** (whose bill; employee-vs-admin) is enforced in the Next
  server actions (`src/app/actions/bills.ts`, `misc.ts`, `visit.ts`).

If you later adopt Supabase Auth, this flips cleanly to client-direct uploads
with per-user Storage RLS.

## Setup

1. **Env** (`.env`):
   ```
   SUPABASE_URL="https://<project-ref>.supabase.co"
   SUPABASE_SERVICE_ROLE_KEY="<service_role key — Project Settings → API>"
   SUPABASE_BILLS_BUCKET="expense-bills"   # optional
   ```
2. The **bucket is auto-created** (private, 10 MB limit, PDF/PNG/JPG/JPEG/WEBP)
   on the first upload. To create it manually instead, run in the Supabase SQL
   editor:
   ```sql
   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
   values ('expense-bills', 'expense-bills', false, 10485760,
           array['application/pdf','image/png','image/jpeg','image/webp'])
   on conflict (id) do nothing;
   ```
3. **Do not add** any `anon`/`authenticated` RLS policies on this bucket — the
   default-deny is exactly what keeps it private. All legitimate access is
   brokered by the server via `service_role`.

## Constraints

- **Types:** PDF, PNG, JPG, JPEG, WEBP only (rejected by MIME **and** extension).
- **Size:** 10 MB max (enforced client-side, in the server action, and by the
  bucket).
- **Naming:** `<employeeCode>/<year>/<month>/<uuid>.<ext>` — collision-free, never
  overwritten.

## Lifecycle

- **Create/Edit expense** → upload → metadata (`billPath`, `billName`,
  `billType`, `billSize`, `billUploadedAt`, `billUploadedBy`) saved on the row.
- **Replace** → old object deleted, new uploaded, row updated.
- **Remove** → object deleted, columns cleared.
- **Delete expense/leg** (employee or admin) → associated object deleted — no
  orphans.
- Every upload/replace/delete is written to the **audit log**
  (`BILL_UPLOAD` / `BILL_REPLACE` / `BILL_DELETE`) with employee, path and IP.
