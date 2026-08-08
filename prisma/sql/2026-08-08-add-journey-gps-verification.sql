-- Proof-of-presence columns for compulsory GPS verification (2026-08-08).
--
-- Logging a visit now requires a device GPS fix that the server itself checks
-- against the destination's geofence (see src/lib/gps.ts). These columns store
-- the fix that authorised each leg, so a visit can be audited after the fact.
--
-- Additive only: every column is nullable and every statement is IF NOT EXISTS,
-- so the script is idempotent and existing Journey rows are untouched. Legs
-- logged before this change keep NULLs — they predate the requirement.

BEGIN;

ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "gpsLat"        DOUBLE PRECISION;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "gpsLng"        DOUBLE PRECISION;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "gpsAccuracy"   DOUBLE PRECISION;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "gpsCapturedAt" TIMESTAMP(3);
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "gpsDistanceM"  DOUBLE PRECISION;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "gpsRadiusM"    INTEGER;

COMMIT;
