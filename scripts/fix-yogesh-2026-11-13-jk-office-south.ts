/** Replace Yogesh's JK Jain -> South link with JK Jain -> Head Office -> South. */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { routeCacheKey } from "../src/lib/routing";
import { buildRouteKey } from "../src/lib/locationNormalizer";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-13";
const JK_LEG_ID = "cmwem1650000bk108ssbzr275";
const SOUTH_LEG_ID = "cmwet2ags0003jy08tztt343x";
const SOUTH_CORRECTION_ID = "cmwet36xc0005jy0856abiz8x";
const NOTE = "Admin corrected the route to JK Jain Residence -> Head Office -> South, Delhi; the original JK Jain -> South correction remains in the audit history.";

async function getDay(db: PrismaClient | Prisma.TransactionClient, employeeId: string) {
  return db.journey.findMany({
    where: { employeeId, workDate: WORK_DATE }, orderBy: { sequence: "asc" },
    include: { claimItem: { select: { claimId: true } },
      distanceCorrection: { select: { id: true, status: true, finalDistanceKm: true,
        originalDistanceKm: true, submittedDistanceKm: true, adminNote: true, routeKey: true } } },
  });
}

async function main() {
  const employees = await prisma.employee.findMany({ where: {
    name: { equals: "Yogesh (Site Supervisior)", mode: "insensitive" }, status: "ACTIVE", deletedAt: null,
  }, select: { id: true, name: true, employeeCode: true } });
  if (employees.length !== 1) throw new Error(`Expected one active Yogesh; found ${employees.length}.`);
  const employee = employees[0];
  const offices = await prisma.site.findMany({ where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true } });
  if (offices.length !== 1) throw new Error(`Expected one active Head Office; found ${offices.length}.`);
  const office = offices[0];
  const day = await getDay(prisma, employee.id);
  const first = day.find((leg) => leg.id === JK_LEG_ID);
  const south = day.find((leg) => leg.id === SOUTH_LEG_ID);
  if (!first || !south || first.sequence !== 0 || first.toName !== "JK JAIN RESIDENCE" ||
      first.fromSiteId !== office.id || first.toSiteId == null ||
      first.toLat == null || first.toLng == null || south.toName !== "South, Delhi" ||
      south.toLat == null || south.toLng == null || south.vehicleType !== "BIKE" ||
      first.vehicleType !== "BIKE") {
    throw new Error("The expected JK Jain and South, Delhi journeys are missing or have changed.");
  }
  if (first.claimItem || south.claimItem) throw new Error("A journey is attached to a claim; review before changing the route.");
  const correction = south.distanceCorrection;
  if (!correction || correction.id !== SOUTH_CORRECTION_ID || correction.status !== "APPROVED" ||
      correction.originalDistanceKm !== 8.4 || correction.submittedDistanceKm !== 13.5) {
    throw new Error("The South, Delhi approved distance correction has changed.");
  }

  const jkPoint = { latitude: first.toLat, longitude: first.toLng };
  const southPoint = { latitude: south.toLat, longitude: south.toLng };
  const [returnCache, southCache] = await Promise.all([
    prisma.distanceCache.findUnique({ where: { key: routeCacheKey(jkPoint, office) } }),
    prisma.distanceCache.findUnique({ where: { key: routeCacheKey(office, southPoint) } }),
  ]);
  if (!returnCache || !southCache || returnCache.source === "HAVERSINE" || southCache.source === "HAVERSINE") {
    throw new Error("A measured road-distance cache is missing for one of the two requested legs.");
  }
  const { routeKey: correctedRouteKey } = buildRouteKey(office.name, south.toName);
  const alreadyCorrected = day.length === 3 &&
    day[1].fromName === first.toName && day[1].toSiteId === office.id &&
    day[1].distanceKm === returnCache.roadKm && day[1].vehicleType === "BIKE" &&
    south.sequence === 2 && south.fromSiteId === office.id && south.fromName === office.name &&
    south.distanceKm === southCache.roadKm && correction.finalDistanceKm === southCache.roadKm &&
    correction.routeKey === correctedRouteKey && correction.adminNote?.includes(NOTE);
  if (!alreadyCorrected && (day.length !== 2 || south.sequence !== 1 || south.fromSiteId !== first.toSiteId ||
      south.distanceKm !== 13.5 || correction.finalDistanceKm !== 13.5)) {
    throw new Error("November 13 contains another route or a partial change; no entries were changed.");
  }

  const settings = await getSettings();
  const returnAmount = computeLegAmount(returnCache.roadKm, "BIKE", settings.rates);
  const southAmount = computeLegAmount(southCache.roadKm, "BIKE", settings.rates);
  console.table([
    { sequence: 0, route: `${first.fromName} -> ${first.toName}`, distanceKm: first.distanceKm, amount: first.amount, action: "keep" },
    { sequence: 1, route: `${first.toName} -> ${office.name}`, distanceKm: returnCache.roadKm, amount: returnAmount, action: alreadyCorrected ? "already added" : APPLY ? "add" : "dry run" },
    { sequence: 2, route: `${office.name} -> ${south.toName}`, distanceKm: southCache.roadKm, amount: southAmount, action: alreadyCorrected ? "already corrected" : APPLY ? "update" : "dry run" },
  ]);
  if (alreadyCorrected || !APPLY) return;

  await prisma.$transaction(async (tx) => {
    const current = await getDay(tx, employee.id);
    if (current.length !== 2 || current[0].id !== JK_LEG_ID || current[1].id !== SOUTH_LEG_ID ||
        current[0].sequence !== 0 || current[1].sequence !== 1 ||
        current[1].distanceKm !== 13.5 || current[1].distanceCorrection?.finalDistanceKm !== 13.5 ||
        current[0].claimItem || current[1].claimItem) {
      throw new Error("Yogesh's November 13 journeys changed during the update.");
    }
    await tx.journey.update({ where: { id: SOUTH_LEG_ID }, data: {
      sequence: 2, fromSiteId: office.id, fromCustomLocationId: null,
      fromName: office.name, fromAddress: office.address,
      fromLat: office.latitude, fromLng: office.longitude,
      distanceKm: southCache.roadKm, roadKm: southCache.roadKm,
      haversineKm: southCache.haversineKm, durationMin: southCache.durationMin,
      source: "CACHE", manualDistance: false, manualReason: null,
      amount: southAmount, distanceUpdated: true, distanceUpdatedAt: new Date(),
      verifiedDistanceKm: null, verifiedDiscrepancyKm: null, verifiedRouteMatch: null,
    } });
    await tx.distanceCorrection.update({ where: { id: SOUTH_CORRECTION_ID }, data: {
      finalDistanceKm: southCache.roadKm, routeKey: correctedRouteKey,
      adminNote: [correction.adminNote, NOTE].filter(Boolean).join("\n"),
    } });
    const returnJourney = await tx.journey.create({ data: {
      employeeId: employee.id, workDate: WORK_DATE, sequence: 1,
      fromSiteId: first.toSiteId, toSiteId: office.id,
      fromName: first.toName, toName: office.name,
      fromAddress: first.toAddress, toAddress: office.address,
      fromLat: jkPoint.latitude, fromLng: jkPoint.longitude,
      toLat: office.latitude, toLng: office.longitude,
      locationType: "MASTER", distanceKm: returnCache.roadKm,
      roadKm: returnCache.roadKm, haversineKm: returnCache.haversineKm,
      durationMin: returnCache.durationMin, source: "CACHE", vehicleType: "BIKE", amount: returnAmount,
    } });
    await tx.auditLog.createMany({ data: [
      { action: "CREATE", entity: "Journey", entityId: returnJourney.id,
        meta: JSON.stringify({ source: "admin-route-fix-script", employeeId: employee.id,
          workDate: WORK_DATE, route: `${first.toName} -> ${office.name}`,
          distanceKm: returnCache.roadKm, amount: returnAmount, vehicleType: "BIKE" }) },
      { action: "UPDATE", entity: "Journey", entityId: SOUTH_LEG_ID,
        meta: JSON.stringify({ source: "admin-route-fix-script", employeeId: employee.id,
          workDate: WORK_DATE, previousRoute: `${south.fromName} -> ${south.toName}`,
          correctedRoute: `${office.name} -> ${south.toName}`,
          previousDistanceKm: south.distanceKm, correctedDistanceKm: southCache.roadKm,
          previousAmount: south.amount, correctedAmount: southAmount,
          distanceCorrectionId: SOUTH_CORRECTION_ID, reason: NOTE }) },
    ] });
  });
  console.log("Added JK Jain Residence -> Head Office and corrected the South, Delhi leg.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
