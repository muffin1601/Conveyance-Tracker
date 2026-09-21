-- Persist the approved distance on the journey record and retain a clear
-- marker for tables and exports. The original submitted value remains in
-- DistanceCorrection.originalDistanceKm for the audit trail.
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "distanceUpdated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "distanceUpdatedAt" TIMESTAMP(3);
