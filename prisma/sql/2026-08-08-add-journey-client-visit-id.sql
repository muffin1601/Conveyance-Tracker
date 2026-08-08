-- Idempotency key for offline visit queueing (2026-08-08).
--
-- A visit logged on a phone with no signal is stored on the device and synced
-- later. That sync can legitimately happen twice (the response to the first
-- attempt was lost, two tabs drained the same queue), so every visit carries a
-- device-generated id. This unique index is what makes the second submission
-- resolve to the row the first one created instead of duplicating the trip.
--
-- Additive only, and idempotent. Existing rows keep NULL; a partial-style
-- unique index in Postgres already permits any number of NULLs, so no
-- backfill is needed and no existing row is touched.

BEGIN;

ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "clientVisitId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Journey_clientVisitId_key"
  ON "Journey" ("clientVisitId");

COMMIT;
