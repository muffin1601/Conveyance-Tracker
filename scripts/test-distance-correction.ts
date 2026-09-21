import assert from "node:assert/strict";
import test from "node:test";
import { distanceDifference, getEffectiveTripDistance, verificationDecision } from "../src/lib/distanceCorrection";

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
