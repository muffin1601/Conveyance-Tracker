-- Full street address per journey endpoint (2026-08-11).
--
-- A leg has only ever stored a short name for each end. For a master Site that
-- is enough (the address is on the Site record), but a GPS leg had nowhere to
-- keep the street address the geocoder returned, so a reviewer looking at
-- "Govindpuri, Delhi" could not tell which building anyone visited.
--
-- Additive and idempotent. Existing rows keep NULL and every reader falls back
-- to the name, so nothing breaks before the backfill
-- (scripts/backfill-gps-names.ts) fills these in from the stored coordinates.

BEGIN;

ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "fromAddress" TEXT;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "toAddress" TEXT;

COMMIT;
