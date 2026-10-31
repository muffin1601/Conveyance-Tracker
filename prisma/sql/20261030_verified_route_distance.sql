-- Feature: Automatic Frequent Correction Detection & Permanent Distance Correction Memory
-- Add userReason column to DistanceCorrection
ALTER TABLE "DistanceCorrection" ADD COLUMN IF NOT EXISTS "userReason" TEXT;

-- Directional normalized route key for efficient frequent-correction lookups
ALTER TABLE "DistanceCorrection" ADD COLUMN IF NOT EXISTS "routeKey" TEXT;
CREATE INDEX IF NOT EXISTS "DistanceCorrection_routeKey_status_idx" ON "DistanceCorrection"("routeKey", "status");

-- Centralized Verified Route Distance Table
CREATE TABLE IF NOT EXISTS "VerifiedRouteDistance" (
  "id" TEXT NOT NULL,
  "routeKey" TEXT NOT NULL,
  "fromNormalized" TEXT NOT NULL,
  "toNormalized" TEXT NOT NULL,
  "fromLocationName" TEXT NOT NULL,
  "toLocationName" TEXT NOT NULL,
  "fromSiteId" TEXT,
  "toSiteId" TEXT,
  "verifiedDistanceKm" DOUBLE PRECISION NOT NULL,
  "approvalCount" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'AUTO_VERIFIED',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerifiedRouteDistance_pkey" PRIMARY KEY ("id")
);

-- Unique index on routeKey to ensure one record per directional route
CREATE UNIQUE INDEX IF NOT EXISTS "VerifiedRouteDistance_routeKey_key" ON "VerifiedRouteDistance"("routeKey");
CREATE INDEX IF NOT EXISTS "VerifiedRouteDistance_fromNormalized_toNormalized_idx" ON "VerifiedRouteDistance"("fromNormalized", "toNormalized");
CREATE INDEX IF NOT EXISTS "VerifiedRouteDistance_status_idx" ON "VerifiedRouteDistance"("status");
CREATE INDEX IF NOT EXISTS "VerifiedRouteDistance_routeKey_idx" ON "VerifiedRouteDistance"("routeKey");
CREATE INDEX IF NOT EXISTS "VerifiedRouteDistance_fromLocationName_toLocationName_idx" ON "VerifiedRouteDistance"("fromLocationName", "toLocationName");

-- Audit trail for every change to verified route distances
CREATE TABLE IF NOT EXISTS "VerifiedRouteAudit" (
  "id" TEXT NOT NULL,
  "verifiedRouteDistanceId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousDistanceKm" DOUBLE PRECISION,
  "newDistanceKm" DOUBLE PRECISION NOT NULL,
  "previousStatus" TEXT,
  "newStatus" TEXT NOT NULL,
  "reason" TEXT,
  "performedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerifiedRouteAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VerifiedRouteAudit_verifiedRouteDistanceId_idx" ON "VerifiedRouteAudit"("verifiedRouteDistanceId");
CREATE INDEX IF NOT EXISTS "VerifiedRouteAudit_createdAt_idx" ON "VerifiedRouteAudit"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VerifiedRouteAudit_verifiedRouteDistanceId_fkey'
  ) THEN
    ALTER TABLE "VerifiedRouteAudit"
      ADD CONSTRAINT "VerifiedRouteAudit_verifiedRouteDistanceId_fkey"
      FOREIGN KEY ("verifiedRouteDistanceId")
      REFERENCES "VerifiedRouteDistance"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
