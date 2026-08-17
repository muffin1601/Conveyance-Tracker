-- Login time on location records (2026-08-17).
--
-- The Location reports showed WHO and WHERE and a date, but never a time, so a
-- reviewer could not tell a 9am site visit from a 9pm one. Staff have no
-- password step in this app — selecting your name on /app IS the login — so
-- that moment is now recorded on Employee, and stamped onto each location
-- record written afterwards.
--
-- Purely additive and idempotent. Every column is nullable and no existing row
-- is touched: legs and saved locations that pre-date this keep NULL, and the
-- reports fall back to createdAt for them, which for those rows genuinely is
-- when the person was at that location. Nothing is back-filled with a guess.

BEGIN;

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "Journey"  ADD COLUMN IF NOT EXISTS "loginAt"     TIMESTAMP(3);
ALTER TABLE "UserCustomLocation" ADD COLUMN IF NOT EXISTS "loginAt" TIMESTAMP(3);

COMMIT;
