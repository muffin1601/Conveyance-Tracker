import assert from "node:assert/strict";
import test from "node:test";
import { distanceDifference, getEffectiveTripDistance, verificationDecision } from "../src/lib/distanceCorrection";
import {
  applyVerifiedRouteDistance,
  isRedundantVerifiedRouteCorrection,
} from "../src/lib/verifiedRouteMath";

test("difference is safe and uses the larger distance", () => {
  const r = distanceDifference(12.4, 18.6);
  assert.equal(r.differenceKm, 6.200000000000001);
  assert.ok(Math.abs(r.differencePercent - 33.333333333333336) < 0.001);
});
test("small and extreme discrepancies require review", () => {
  assert.equal(verificationDecision({ differencePercent: 3, endpointMatch: true, usableGpsPoints: 2, hasScreenshot: true }).status, "MANUAL_REVIEW");
  assert.equal(verificationDecision({ differencePercent: 21, endpointMatch: true, usableGpsPoints: 2, hasScreenshot: true }).status, "MANUAL_REVIEW");
});
test("moderate evidence can verify and the original distance remains auditable", () => {
  assert.equal(verificationDecision({ differencePercent: 10, endpointMatch: true, usableGpsPoints: 2, hasScreenshot: true }).status, "AUTO_VERIFIED");
  assert.equal(getEffectiveTripDistance({ distanceKm: 12.4, distanceCorrection: null }), 12.4);
  assert.equal(getEffectiveTripDistance({ distanceKm: 12.4, distanceCorrection: { status: "APPROVED", finalDistanceKm: 18.6 } }), 18.6);
  assert.equal(getEffectiveTripDistance({ distanceKm: 12.4, distanceCorrection: { status: "REJECTED", finalDistanceKm: null } }), 12.4);
});

test("a verified distance may correct a recorded mismatch but duplicate matching corrections are suppressed", () => {
  assert.equal(isRedundantVerifiedRouteCorrection(8.5, 12.5, 12.5), false);
  assert.equal(isRedundantVerifiedRouteCorrection(12.5, 12.5, 12.5), true);
  assert.equal(isRedundantVerifiedRouteCorrection(12.5, 16, 12.5), false);
  assert.equal(isRedundantVerifiedRouteCorrection(8.5, 16, 12.5), false);
});

test("verified route memory auto-corrects only distances outside the configured tolerance", () => {
  assert.deepEqual(
    applyVerifiedRouteDistance(8.5, {
      isVerified: true,
      verifiedDistanceKm: 12.5,
      exceedsTolerance: true,
    }),
    { distanceKm: 12.5, submittedDistanceKm: 8.5, autoCorrected: true },
  );
  assert.deepEqual(
    applyVerifiedRouteDistance(12.4, {
      isVerified: true,
      verifiedDistanceKm: 12.5,
      exceedsTolerance: false,
    }),
    { distanceKm: 12.4, submittedDistanceKm: null, autoCorrected: false },
  );
  assert.deepEqual(
    applyVerifiedRouteDistance(8.5, {
      isVerified: false,
      verifiedDistanceKm: null,
      exceedsTolerance: false,
    }),
    { distanceKm: 8.5, submittedDistanceKm: null, autoCorrected: false },
  );
});
