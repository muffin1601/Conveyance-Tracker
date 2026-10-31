-- Snapshot verified-route comparison on Journey at log time.
-- Does not change historical distanceKm values.
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "verifiedDistanceKm" DOUBLE PRECISION;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "verifiedDiscrepancyKm" DOUBLE PRECISION;
ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "verifiedRouteMatch" TEXT;
CREATE INDEX IF NOT EXISTS "Journey_verifiedRouteMatch_idx" ON "Journey"("verifiedRouteMatch");
