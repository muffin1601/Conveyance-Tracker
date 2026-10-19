/**
 * Add the requested round trips for T Mohapatra:
 *   Head Office -> Bliss Villa -> Head Office
 * on 17 and 19 October 2026.
 *
 * Run without --apply to preview. The script replaces the already-recorded
 * 17 October outbound leg, then creates the other three requested legs.
 */
import { PrismaClient } from "@prisma/client";
import { calculateRoadDistance, isRoadDistance } from "../src/lib/routing";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const DATES = ["2026-10-17", "2026-10-19"];

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function main() {
  const employee = await exactlyOne(await prisma.employee.findMany({
    where: { name: { contains: "mohapatra", mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true },
  }), "employee matching Mohapatra");
  const office = await exactlyOne(await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, latitude: true, longitude: true },
  }), "active head office");
  const blissVilla = await exactlyOne(await prisma.site.findMany({
    where: { name: { contains: "blissvi", mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true, latitude: true, longitude: true },
  }), "active Bliss Villa site");
  const settings = await getSettings();

  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: { in: DATES } },
    select: {
      id: true, workDate: true, sequence: true, fromName: true, toName: true,
      fromSiteId: true, toSiteId: true, fromCustomLocationId: true, toCustomLocationId: true,
      arrivalVisitId: true,
      fromLat: true, fromLng: true, toLat: true, toLng: true,
      distanceKm: true, amount: true, source: true,
    },
    orderBy: [{ workDate: "asc" }, { sequence: "asc" }],
  });
  const existingOutbound = existing.find((leg) => leg.workDate === "2026-10-17" && leg.sequence === 0);
  const requestedLegsAlreadyExist = existing.length === 4 && existing.every((leg) => {
    const outbound = leg.sequence === 0;
    return leg.fromSiteId === (outbound ? office.id : blissVilla.id) &&
      leg.toSiteId === (outbound ? blissVilla.id : office.id) &&
      leg.fromCustomLocationId === null && leg.toCustomLocationId === null &&
      ["2026-10-17", "2026-10-19"].includes(leg.workDate);
  });
  if (requestedLegsAlreadyExist) {
    console.log("The requested four Blissville conveyance legs already exist; no changes made.");
    return;
  }
  const unexpected = existing.filter((leg) => leg !== existingOutbound);
  if (!existingOutbound || unexpected.length) {
    throw new Error(`Expected only the existing 17 October outbound leg; found:\n${JSON.stringify(existing, null, 2)}`);
  }
  if (existingOutbound.arrivalVisitId) {
    throw new Error("The existing 17 October leg is linked to a site visit, so it cannot safely be replaced automatically.");
  }

  const route = await calculateRoadDistance({
    origin: { latitude: office.latitude, longitude: office.longitude },
    destination: { latitude: blissVilla.latitude, longitude: blissVilla.longitude },
  });
  if (!isRoadDistance(route.source) || !route.routeAvailable) {
    throw new Error("A road route could not be measured; no entries were created.");
  }
  const amount = computeLegAmount(route.distanceKm, employee.vehicleType as VehicleType, settings.rates);
  const returnRoute = await calculateRoadDistance({
    origin: { latitude: blissVilla.latitude, longitude: blissVilla.longitude },
    destination: { latitude: office.latitude, longitude: office.longitude },
  });
  if (!isRoadDistance(returnRoute.source) || !returnRoute.routeAvailable) {
    throw new Error("The return road route could not be measured; no entries were created.");
  }
  const returnAmount = computeLegAmount(returnRoute.distanceKm, employee.vehicleType as VehicleType, settings.rates);

  const replacement = { workDate: "2026-10-17", sequence: 0, from: office, to: blissVilla, route, amount };
  const newEntries = [
    { workDate: "2026-10-17", sequence: 1, from: blissVilla, to: office, route: returnRoute, amount: returnAmount },
    { workDate: "2026-10-19", sequence: 0, from: office, to: blissVilla, route, amount },
    { workDate: "2026-10-19", sequence: 1, from: blissVilla, to: office, route: returnRoute, amount: returnAmount },
  ];
  const entries = [replacement, ...newEntries];
  console.table(entries.map((entry) => ({
    date: entry.workDate,
    route: `${entry.from.name} -> ${entry.to.name}`,
    distanceKm: entry.route.distanceKm,
    amount: entry.amount,
    source: entry.route.source,
  })));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add these four entries.");
    return;
  }

  const journeyData = (entry: typeof replacement) => ({
      employeeId: employee.id,
      workDate: entry.workDate,
      fromSiteId: entry.from.id,
      toSiteId: entry.to.id,
      fromName: entry.from.name,
      toName: entry.to.name,
      fromLat: entry.from.latitude,
      fromLng: entry.from.longitude,
      toLat: entry.to.latitude,
      toLng: entry.to.longitude,
      sequence: entry.sequence,
      distanceKm: entry.route.distanceKm,
      roadKm: entry.route.distanceKm,
      haversineKm: Math.round(
        (haversineMeters(
          { lat: entry.from.latitude, lng: entry.from.longitude },
          { lat: entry.to.latitude, lng: entry.to.longitude },
        ) / 1000) * 100,
      ) / 100,
      durationMin: Math.round(entry.route.durationSeconds / 60),
      source: entry.route.source,
      vehicleType: employee.vehicleType,
      amount: entry.amount,
    });
  await prisma.$transaction([
    prisma.journey.update({ where: { id: existingOutbound.id }, data: journeyData(replacement) }),
    ...newEntries.map((entry) => prisma.journey.create({ data: journeyData(entry) })),
  ]);
  console.log("Replaced the 17 October outbound leg and added the remaining three conveyance legs for T Mohapatra.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
