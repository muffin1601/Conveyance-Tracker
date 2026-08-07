-- Additive-only repair of production schema drift (2026-08-07).
--
-- The deployed database was missing four tables that the Prisma schema (and
-- therefore the running app) expects. The most damaging absence was
-- "DistanceCache": every fare preview and every logged trip calls
-- computeDistance, which reads that table first, so every read raised
-- P2021 ("table does not exist") and surfaced as a 500 in the browser.
--
-- This script ONLY creates. It issues no DROP and no ALTER against existing
-- tables, so the legacy "AdminLockout", "Device" and "JourneyPoint" tables —
-- which hold live data but are absent from the schema — are left untouched.
-- (`prisma db push` would have proposed dropping them; that is why it was not
-- used.) Every statement is IF NOT EXISTS, so the script is idempotent.

BEGIN;

-- ── DistanceCache — the one breaking trip logging ──────────────────────
CREATE TABLE IF NOT EXISTS "DistanceCache" (
    "id"          TEXT             NOT NULL,
    "key"         TEXT             NOT NULL,
    "roadKm"      DOUBLE PRECISION NOT NULL,
    "haversineKm" DOUBLE PRECISION NOT NULL,
    "durationMin" INTEGER          NOT NULL,
    "source"      TEXT             NOT NULL DEFAULT 'GOOGLE',
    "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistanceCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DistanceCache_key_key" ON "DistanceCache" ("key");
CREATE INDEX        IF NOT EXISTS "DistanceCache_key_idx" ON "DistanceCache" ("key");

-- ── Claim ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Claim" (
    "id"          TEXT             NOT NULL,
    "employeeId"  TEXT             NOT NULL,
    "periodMonth" TEXT             NOT NULL,
    "totalKm"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status"      TEXT             NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "paidAt"      TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Claim_employeeId_periodMonth_key"
    ON "Claim" ("employeeId", "periodMonth");
CREATE INDEX IF NOT EXISTS "Claim_status_idx" ON "Claim" ("status");

-- ── ClaimItem ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ClaimItem" (
    "id"        TEXT             NOT NULL,
    "claimId"   TEXT             NOT NULL,
    "journeyId" TEXT             NOT NULL,
    "km"        DOUBLE PRECISION NOT NULL,
    "amount"    DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ClaimItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClaimItem_journeyId_key" ON "ClaimItem" ("journeyId");
CREATE INDEX        IF NOT EXISTS "ClaimItem_claimId_idx"   ON "ClaimItem" ("claimId");

-- ── Approval ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Approval" (
    "id"        TEXT         NOT NULL,
    "claimId"   TEXT         NOT NULL,
    "actorId"   TEXT         NOT NULL,
    "stage"     TEXT         NOT NULL,
    "decision"  TEXT         NOT NULL,
    "note"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Approval_claimId_idx" ON "Approval" ("claimId");

-- ── Foreign keys ───────────────────────────────────────────────────────
-- Added last so table creation order does not matter. Each is guarded, since
-- ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Claim_employeeId_fkey') THEN
        ALTER TABLE "Claim" ADD CONSTRAINT "Claim_employeeId_fkey"
            FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClaimItem_claimId_fkey') THEN
        ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_claimId_fkey"
            FOREIGN KEY ("claimId") REFERENCES "Claim" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClaimItem_journeyId_fkey') THEN
        ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_journeyId_fkey"
            FOREIGN KEY ("journeyId") REFERENCES "Journey" ("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Approval_claimId_fkey') THEN
        ALTER TABLE "Approval" ADD CONSTRAINT "Approval_claimId_fkey"
            FOREIGN KEY ("claimId") REFERENCES "Claim" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Approval_actorId_fkey') THEN
        ALTER TABLE "Approval" ADD CONSTRAINT "Approval_actorId_fkey"
            FOREIGN KEY ("actorId") REFERENCES "User" ("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
