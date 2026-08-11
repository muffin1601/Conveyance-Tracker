-- Reason for a hand-entered distance that differs from the routed one (2026-08-11).
--
-- The manual km box exists for saved locations that have no coordinates, but
-- it was also being used on legs that COULD be routed — 19 of them, every one
-- a round number, together claiming ₹115 more than the measured road distance.
-- Nobody was cheating; typing "2" was simply faster than waiting for the
-- estimate. The app now shows the measured distance next to the box and asks
-- for a reason when the two disagree materially; this is where that reason goes.
--
-- Additive and idempotent. Existing rows keep NULL, which is correct: no
-- reason was ever asked for, and inventing one would be worse than none.

BEGIN;

ALTER TABLE "Journey" ADD COLUMN IF NOT EXISTS "manualReason" TEXT;

COMMIT;
