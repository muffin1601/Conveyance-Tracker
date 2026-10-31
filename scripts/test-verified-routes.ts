import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLocationName,
  buildRouteKey,
} from "../src/lib/locationNormalizer";
import { calculateDistanceDiscrepancy } from "../src/lib/verifiedRouteMath";
import {
  lookupVerifiedRoute,
  compareSubmittedToVerifiedRoute,
  manuallyVerifyRoute,
  updateVerifiedDistance,
  setVerifiedRouteStatus,
  processApprovedCorrection,
  getVerifiedRouteConfig,
} from "../src/lib/verifiedRoutes";
import { prisma } from "../src/lib/prisma";

test("Scenario 11: Location Normalizer unifies spelling variations, abbreviations & Roman numerals", () => {
  const norm1 = normalizeLocationName("Watcon International — Head Office");
  const norm2 = normalizeLocationName("Watcon Head Office");
  const norm3 = normalizeLocationName("Head Office");
  assert.equal(norm1, "head office");
  assert.equal(norm2, "head office");
  assert.equal(norm3, "head office");

  const okhla1 = normalizeLocationName("Okhla Phase - II, Delhi");
  const okhla2 = normalizeLocationName("Okhla Phase II, Delhi");
  const okhla3 = normalizeLocationName("Okhla Phase 2, Delhi");
  assert.equal(okhla1, "okhla phase 2 delhi");
  assert.equal(okhla2, "okhla phase 2 delhi");
  assert.equal(okhla3, "okhla phase 2 delhi");

  const routeKey1 = buildRouteKey("Watcon International — Head Office", "Okhla Phase - II, Delhi");
  const routeKey2 = buildRouteKey("Head Office", "Okhla Phase 2, Delhi");
  assert.equal(routeKey1.routeKey, routeKey2.routeKey);
  assert.equal(routeKey1.routeKey, "head office:::okhla phase 2 delhi");
});

test("Scenario 10: Routes with reversed From/To locations have distinct directional keys", () => {
  const forward = buildRouteKey("Watcon Showroom", "Chattarpur Farms, Delhi");
  const reverse = buildRouteKey("Chattarpur Farms, Delhi", "Watcon Showroom");

  assert.notEqual(forward.routeKey, reverse.routeKey);
  assert.equal(forward.routeKey, "watcon showroom:::chattarpur farms delhi");
  assert.equal(reverse.routeKey, "chattarpur farms delhi:::watcon showroom");
});

test("Scenario 5: Submitted distance matching verified distance within tolerance", () => {
  // Verified distance is 15.0 KM, submitted is 15.3 KM (diff: 0.3 KM <= 0.5 KM tolerance)
  const result = calculateDistanceDiscrepancy(15.3, 15.0, 0.5, 5);
  assert.equal(result.matchesWithinTolerance, true);
  assert.equal(result.exceedsTolerance, false);
  assert.equal(result.differenceKm, -0.3);
});

test("Scenario 6: Submitted distance exceeding allowed tolerance is flagged", () => {
  // Verified distance is 15.0 KM, submitted is 18.5 KM (diff: 3.5 KM > 0.5 KM and > 5%)
  const result = calculateDistanceDiscrepancy(18.5, 15.0, 0.5, 5);
  assert.equal(result.matchesWithinTolerance, false);
  assert.equal(result.exceedsTolerance, true);
  assert.equal(result.differenceKm, -3.5);
  assert.ok(result.differencePercent > 18);

  const shorterSubmission = calculateDistanceDiscrepancy(12, 15, 0.5, 5);
  assert.equal(shorterSubmission.differenceKm, 3);
});

test("Scenario 1: A new route with no correction history returns not verified", async () => {
  const result = await lookupVerifiedRoute("Random Place Alpha Nonexistent", "Random Place Beta Nonexistent");
  assert.equal(result.isVerified, false);
  assert.equal(result.verifiedDistanceKm, null);
  assert.equal(result.verifiedRoute, null);
});

test("Scenarios 2, 3, 4, 7, 8, 9, 12: Database lifecycle of verified routes & admin override", async () => {
  const testFrom = "Test Hub X900";
  const testTo = "Test Destination Y900";
  const { routeKey } = buildRouteKey(testFrom, testTo);

  // Clean up any test artifact from prior test runs
  await prisma.verifiedRouteAudit.deleteMany({
    where: { verifiedRoute: { routeKey } },
  });
  await prisma.verifiedRouteDistance.deleteMany({
    where: { routeKey },
  });

  // Scenario 1 verification for this test route
  const initial = await lookupVerifiedRoute(testFrom, testTo);
  assert.equal(initial.isVerified, false);

  // Scenario 12: Admin manually verifying a route
  const manuallyCreated = await manuallyVerifyRoute({
    fromLocation: testFrom,
    toLocation: testTo,
    distanceKm: 22.4,
    notes: "Initial manual verification for testing",
  });

  assert.equal(manuallyCreated.routeKey, routeKey);
  assert.equal(manuallyCreated.verifiedDistanceKm, 22.4);
  assert.equal(manuallyCreated.status, "ACTIVE");
  assert.equal(manuallyCreated.source, "MANUAL_ADMIN");
  assert.equal(manuallyCreated.approvalCount, 0);

  // Scenario 4: Repeated lookup retrieves the verified distance
  const lookupAfterManual = await lookupVerifiedRoute(testFrom, testTo);
  assert.equal(lookupAfterManual.isVerified, true);
  assert.equal(lookupAfterManual.verifiedDistanceKm, 22.4);

  // Scenario 12 (continued): Admin updates existing verified distance with audit log
  const updated = await updateVerifiedDistance({
    id: manuallyCreated.id,
    distanceKm: 23.0,
    notes: "Updated route distance due to bypass road",
  });
  assert.equal(updated.verifiedDistanceKm, 23.0);

  // Verify audit log entry exists
  const audits = await prisma.verifiedRouteAudit.findMany({
    where: { verifiedRouteDistanceId: manuallyCreated.id },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(audits.length >= 2);
  assert.equal(audits[0].newDistanceKm, 23.0);
  assert.equal(audits[0].previousDistanceKm, 22.4);
  assert.equal(audits[0].action, "MANUAL_UPDATE");

  // Test disable/archive
  await setVerifiedRouteStatus({
    id: manuallyCreated.id,
    status: "DISABLED",
    reason: "Test disabling route",
  });
  const lookupDisabled = await lookupVerifiedRoute(testFrom, testTo);
  assert.equal(lookupDisabled.isVerified, false); // Disabled routes do not auto-match

  // Clean up test records
  await prisma.verifiedRouteAudit.deleteMany({
    where: { verifiedRouteDistanceId: manuallyCreated.id },
  });
  await prisma.verifiedRouteDistance.deleteMany({
    where: { id: manuallyCreated.id },
  });
});

test("Scenarios 2-3 + MANUAL_ADMIN protection: threshold creates memory; admin distance is not overwritten", async () => {
  const config = await getVerifiedRouteConfig();
  const threshold = Math.max(1, config.detectionThreshold);

  const testFrom = "Auto Threshold Hub Z801";
  const testTo = "Auto Threshold Dest Z802";
  const { routeKey } = buildRouteKey(testFrom, testTo);

  // Isolate: remove prior artifacts for this synthetic route
  await prisma.verifiedRouteAudit.deleteMany({ where: { verifiedRoute: { routeKey } } });
  await prisma.verifiedRouteDistance.deleteMany({ where: { routeKey } });

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { id: true },
    take: 2,
  });
  if (!employees.length) {
    console.warn("Skipping threshold test: no employee in database");
    return;
  }

  const createdCorrectionIds: string[] = [];
  const createdJourneyIds: string[] = [];

  try {
    // Create N approved corrections for the same directional route (threshold)
    for (let i = 0; i < threshold; i++) {
      const journey = await prisma.journey.create({
        data: {
          employeeId: employees[i % employees.length].id,
          workDate: `2099-01-${String(i + 1).padStart(2, "0")}`,
          sequence: i + 1,
          fromName: testFrom,
          toName: testTo,
          distanceKm: 12,
          haversineKm: 12,
          amount: 0,
          vehicleType: "BIKE",
          locationType: "MASTER",
          source: "MANUAL",
        },
      });
      createdJourneyIds.push(journey.id);

      const correction = await prisma.distanceCorrection.create({
        data: {
          journeyId: journey.id,
          employeeId: employees[i % employees.length].id,
          originalDistanceKm: 12,
          submittedDistanceKm: 15,
          finalDistanceKm: 15,
          screenshotPath: `test/threshold-${i}.jpg`,
          screenshotName: `threshold-${i}.jpg`,
          screenshotType: "image/jpeg",
          screenshotSize: 1024,
          status: "APPROVED",
          differenceKm: 3,
          differencePercent: 25,
          routeKey,
          reviewedAt: new Date(),
        },
      });
      createdCorrectionIds.push(correction.id);
    }

    // Scenario 7/8 guard: pending/rejected must not create verified memory by themselves.
    // processApprovedCorrection only runs on APPROVED rows (already gated in the function).
    const lastId = createdCorrectionIds[createdCorrectionIds.length - 1]!;
    const result = await processApprovedCorrection(lastId);
    assert.equal(result.thresholdMet, true);
    assert.ok(result.approvalCount >= threshold);
    assert.equal(result.verifiedDistanceKm, 15);
    assert.equal(result.verifiedRoute?.source, "AUTO_VERIFIED");

    const routeEmployees = await prisma.distanceCorrection.findMany({
      where: { routeKey, status: "APPROVED" },
      select: { employeeId: true },
    });
    assert.equal(
      new Set(routeEmployees.map((correction) => correction.employeeId)).size,
      Math.min(employees.length, threshold)
    );

    const afterAuto = await lookupVerifiedRoute(testFrom, testTo);
    assert.equal(afterAuto.isVerified, true);
    assert.equal(afterAuto.verifiedDistanceKm, 15);

    // Admin overrides the auto-learned distance
    const manual = await manuallyVerifyRoute({
      fromLocation: testFrom,
      toLocation: testTo,
      distanceKm: 18.5,
      notes: "Admin override for MANUAL_ADMIN protection test",
    });
    assert.equal(manual.source, "MANUAL_ADMIN");
    assert.equal(manual.verifiedDistanceKm, 18.5);

    // Another approval at a different median must NOT overwrite MANUAL_ADMIN km
    const extraJourney = await prisma.journey.create({
      data: {
        employeeId: employees[1 % employees.length].id,
        workDate: "2099-02-01",
        sequence: 1,
        fromName: testFrom,
        toName: testTo,
        distanceKm: 12,
        haversineKm: 12,
        amount: 0,
        vehicleType: "BIKE",
        locationType: "MASTER",
        source: "MANUAL",
      },
    });
    createdJourneyIds.push(extraJourney.id);
    const extraCorrection = await prisma.distanceCorrection.create({
      data: {
        journeyId: extraJourney.id,
        employeeId: employees[1 % employees.length].id,
        originalDistanceKm: 12,
        submittedDistanceKm: 16,
        finalDistanceKm: 16,
        screenshotPath: "test/threshold-extra.jpg",
        screenshotName: "threshold-extra.jpg",
        screenshotType: "image/jpeg",
        screenshotSize: 1024,
        status: "APPROVED",
        differenceKm: 4,
        differencePercent: 25,
        routeKey,
        reviewedAt: new Date(),
      },
    });
    createdCorrectionIds.push(extraCorrection.id);

    const protectedResult = await processApprovedCorrection(extraCorrection.id);
    assert.equal(protectedResult.thresholdMet, true);
    assert.equal(protectedResult.verifiedDistanceKm, 18.5); // preserved
    assert.equal(protectedResult.verifiedRoute?.source, "MANUAL_ADMIN");
    assert.ok((protectedResult.approvalCount ?? 0) >= threshold + 1);

    const lookupProtected = await lookupVerifiedRoute(testFrom, testTo);
    assert.equal(lookupProtected.verifiedDistanceKm, 18.5);

    const match = await compareSubmittedToVerifiedRoute(testFrom, testTo, 18.4);
    assert.equal(match.isVerified, true);
    assert.equal(match.verifiedRouteMatch, "MATCH");
    const exceed = await compareSubmittedToVerifiedRoute(testFrom, testTo, 30);
    assert.equal(exceed.verifiedRouteMatch, "EXCEEDS");
    assert.equal(exceed.exceedsTolerance, true);
  } finally {
    // Clean up synthetic rows (corrections cascade with journeys)
    if (createdCorrectionIds.length) {
      await prisma.distanceCorrection.deleteMany({ where: { id: { in: createdCorrectionIds } } });
    }
    if (createdJourneyIds.length) {
      await prisma.journey.deleteMany({ where: { id: { in: createdJourneyIds } } });
    }
    await prisma.verifiedRouteAudit.deleteMany({ where: { verifiedRoute: { routeKey } } });
    await prisma.verifiedRouteDistance.deleteMany({ where: { routeKey } });
  }
});

test("Scenarios 7-8: Pending and rejected corrections must not update verified distance", async () => {
  const testFrom = "Pending Hub Q101";
  const testTo = "Pending Dest Q102";
  const { routeKey } = buildRouteKey(testFrom, testTo);

  await prisma.verifiedRouteAudit.deleteMany({ where: { verifiedRoute: { routeKey } } });
  await prisma.verifiedRouteDistance.deleteMany({ where: { routeKey } });

  const employee = await prisma.employee.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  });
  if (!employee) {
    console.warn("Skipping pending/rejected test: no employee in database");
    return;
  }

  const journeyIds: string[] = [];
  const correctionIds: string[] = [];
  try {
    for (const status of ["MANUAL_REVIEW", "REJECTED"] as const) {
      const journey = await prisma.journey.create({
        data: {
          employeeId: employee.id,
          workDate: status === "REJECTED" ? "2099-03-02" : "2099-03-01",
          sequence: 1,
          fromName: testFrom,
          toName: testTo,
          distanceKm: 10,
          haversineKm: 10,
          amount: 0,
          vehicleType: "BIKE",
          locationType: "MASTER",
          source: "MANUAL",
        },
      });
      journeyIds.push(journey.id);
      const correction = await prisma.distanceCorrection.create({
        data: {
          journeyId: journey.id,
          employeeId: employee.id,
          originalDistanceKm: 10,
          submittedDistanceKm: 14,
          finalDistanceKm: status === "REJECTED" ? null : 14,
          screenshotPath: `test/${status}.jpg`,
          screenshotName: `${status}.jpg`,
          screenshotType: "image/jpeg",
          screenshotSize: 1024,
          status,
          differenceKm: 4,
          differencePercent: 40,
          routeKey,
        },
      });
      correctionIds.push(correction.id);
      const result = await processApprovedCorrection(correction.id);
      assert.equal(result.thresholdMet, false);
      assert.equal(result.verifiedRoute, null);
    }

    const lookup = await lookupVerifiedRoute(testFrom, testTo);
    assert.equal(lookup.isVerified, false);
  } finally {
    if (correctionIds.length) await prisma.distanceCorrection.deleteMany({ where: { id: { in: correctionIds } } });
    if (journeyIds.length) await prisma.journey.deleteMany({ where: { id: { in: journeyIds } } });
    await prisma.verifiedRouteAudit.deleteMany({ where: { verifiedRoute: { routeKey } } });
    await prisma.verifiedRouteDistance.deleteMany({ where: { routeKey } });
  }
});
