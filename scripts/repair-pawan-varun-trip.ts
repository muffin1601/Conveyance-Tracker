/**
 * Repair Pawan's 21 October 2026 journey chain:
 *   Trip 1: Head Office -> Varun Khurana (missing entry)
 *   Trip 2: Varun Khurana -> Gulmohar 6 no. (existing entry with wrong origin)
 *
 * Run without --apply to preview. The script is idempotent and refuses to
 * change data unless it finds the one exact source row described above.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-21";

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function cachedRoute(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  const coordinate = (value: number) => value.toFixed(5);
  const key = `${coordinate(origin.latitude)},${coordinate(origin.longitude)}|${coordinate(destination.latitude)},${coordinate(destination.longitude)}`;
  const cached = await prisma.distanceCache.findUnique({
    where: { key },
  });
  if (!cached) return null;
  return {
    distanceKm: cached.roadKm,
    durationSeconds: cached.durationMin * 60,
    source: "CACHE" as const,
  };
}

function localEstimate(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
) {
  const straightLineKm = haversineMeters(
    { lat: origin.latitude, lng: origin.longitude },
    { lat: destination.latitude, lng: destination.longitude },
  ) / 1000;
  const distanceKm = Math.round(straightLineKm * 1.3 * 100) / 100;
  return {
    distanceKm,
    durationSeconds: Math.round((distanceKm / 24) * 3600),
    source: "HAVERSINE" as const,
  };
}

async function main() {
  const employee = await exactlyOne(await prisma.employee.findMany({
    where: { employeeCode: "WAT-0032", name: "Pawan" },
    select: { id: true, name: true, employeeCode: true, vehicleType: true },
  }), "Pawan (WAT-0032)");
  const office = await exactlyOne(await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Head Office");
  const varun = await exactlyOne(await prisma.site.findMany({
    where: { name: { equals: "VARUN KHURANA", mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Varun Khurana site");
  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: {
      id: true, sequence: true, fromSiteId: true, fromCustomLocationId: true,
      toSiteId: true, toCustomLocationId: true, fromName: true, toName: true,
      toAddress: true, toLat: true, toLng: true, locationType: true,
      distanceKm: true, amount: true, arrivalVisitId: true, loginAt: true,
      createdAt: true,
    },
  });

  const alreadyRepaired = existing.length === 2 &&
    existing[0].sequence === 0 && existing[0].fromSiteId === office.id && existing[0].toSiteId === varun.id &&
    existing[1].sequence === 1 && existing[1].fromSiteId === varun.id &&
    existing[1].toName?.toLowerCase().includes("gulmohar 6");
  if (alreadyRepaired) {
    console.log("Pawan's requested two-trip chain already exists; no changes made.");
    return;
  }

  const gulmoharLeg = existing[0];
  if (
    existing.length !== 1 || !gulmoharLeg || gulmoharLeg.sequence !== 0 ||
    gulmoharLeg.fromSiteId !== office.id || gulmoharLeg.fromCustomLocationId !== null ||
    !gulmoharLeg.toName?.toLowerCase().includes("gulmohar 6") ||
    gulmoharLeg.toLat == null || gulmoharLeg.toLng == null
  ) {
    throw new Error(`The source journey no longer matches the expected single Head Office -> Gulmohar leg:\n${JSON.stringify(existing, null, 2)}`);
  }
  if (gulmoharLeg.arrivalVisitId) {
    throw new Error("The existing Gulmohar leg is linked to a site visit and cannot be safely rewritten.");
  }

  const [firstRoute, cachedSecondRoute, settings] = await Promise.all([
    cachedRoute(office, varun),
    cachedRoute(varun, { latitude: gulmoharLeg.toLat, longitude: gulmoharLeg.toLng }),
    getSettings(),
  ]);
  if (!firstRoute) {
    throw new Error("No cached road route exists from Head Office to Varun Khurana; no changes made.");
  }
  const secondDestination = { latitude: gulmoharLeg.toLat, longitude: gulmoharLeg.toLng };
  const secondRoute = cachedSecondRoute ?? localEstimate(varun, secondDestination);

  const vehicleType = employee.vehicleType as VehicleType;
  const firstAmount = computeLegAmount(firstRoute.distanceKm, vehicleType, settings.rates);
  const secondAmount = computeLegAmount(secondRoute.distanceKm, vehicleType, settings.rates);
  console.table([
    { trip: 1, route: `${office.name} -> ${varun.name}`, distanceKm: firstRoute.distanceKm, amount: firstAmount, source: firstRoute.source },
    { trip: 2, route: `${varun.name} -> ${gulmoharLeg.toName}`, distanceKm: secondRoute.distanceKm, amount: secondAmount, source: secondRoute.source },
  ]);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write these two entries.");
    return;
  }

  const haversineKm = (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) =>
    Math.round((haversineMeters(
      { lat: from.latitude, lng: from.longitude },
      { lat: to.latitude, lng: to.longitude },
    ) / 1000) * 100) / 100;
  const createdAt = new Date(gulmoharLeg.createdAt.getTime() - 1000);

  await prisma.$transaction([
    // Renumber the existing leg first so sequence 0 is free for the missing
    // first trip. The unique employee/date/sequence constraint is immediate.
    prisma.journey.update({
      where: { id: gulmoharLeg.id },
      data: {
        sequence: 1,
        fromSiteId: varun.id,
        fromCustomLocationId: null,
        fromName: varun.name,
        fromAddress: varun.address,
        fromLat: varun.latitude,
        fromLng: varun.longitude,
        distanceKm: secondRoute.distanceKm,
        roadKm: secondRoute.source === "HAVERSINE" ? null : secondRoute.distanceKm,
        haversineKm: haversineKm(varun, secondDestination),
        durationMin: Math.round(secondRoute.durationSeconds / 60),
        source: secondRoute.source,
        amount: secondAmount,
      },
    }),
    prisma.journey.create({
      data: {
        employeeId: employee.id,
        workDate: WORK_DATE,
        fromSiteId: office.id,
        toSiteId: varun.id,
        fromName: office.name,
        toName: varun.name,
        fromAddress: office.address,
        toAddress: varun.address,
        fromLat: office.latitude,
        fromLng: office.longitude,
        toLat: varun.latitude,
        toLng: varun.longitude,
        locationType: "MASTER",
        sequence: 0,
        distanceKm: firstRoute.distanceKm,
        roadKm: firstRoute.distanceKm,
        haversineKm: haversineKm(office, varun),
        durationMin: Math.round(firstRoute.durationSeconds / 60),
        source: firstRoute.source,
        vehicleType: employee.vehicleType,
        amount: firstAmount,
        loginAt: gulmoharLeg.loginAt,
        createdAt,
      },
    }),
  ]);

  console.log("Updated Pawan's 21 October journey to Head Office -> Varun Khurana -> Gulmohar 6 no.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
