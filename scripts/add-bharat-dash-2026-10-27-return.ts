/** Add Bharat Dash's 27 October 2026 return from his last recorded location to Head Office. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { calculateRoadDistance, isRoadDistance } from "../src/lib/routing";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-27";

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function main() {
  const employee = await exactlyOne(await prisma.employee.findMany({
    where: { name: { equals: "Bharat Dash", mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true },
  }), "employee named Bharat Dash");
  const office = await exactlyOne(await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Head Office");
  const legs = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    include: {
      toSite: { select: { name: true, address: true, latitude: true, longitude: true } },
      toCustomLocation: { select: { locationName: true, address: true, latitude: true, longitude: true } },
    },
  });
  if (legs.length === 0) throw new Error(`No recorded trips for Bharat Dash on ${WORK_DATE}.`);
  const last = legs[legs.length - 1];
  if (last.toSiteId === office.id) {
    console.log(`The last recorded trip already ends at ${office.name}; no return entry needed.`);
    return;
  }

  const origin = {
    name: last.toName ?? last.toSite?.name ?? last.toCustomLocation?.locationName,
    address: last.toAddress ?? last.toSite?.address ?? last.toCustomLocation?.address ?? null,
    latitude: last.toLat ?? last.toSite?.latitude ?? last.toCustomLocation?.latitude ?? null,
    longitude: last.toLng ?? last.toSite?.longitude ?? last.toCustomLocation?.longitude ?? null,
  };
  if (!origin.name || origin.latitude == null || origin.longitude == null) {
    throw new Error(`The last destination does not have a usable name and coordinates; no entry was added: ${JSON.stringify(origin)}`);
  }

  const route = await calculateRoadDistance({
    origin: {
      latitude: origin.latitude!,
      longitude: origin.longitude!,
    },
    destination: office,
  });
  if (!route.routeAvailable || !isRoadDistance(route.source)) {
    throw new Error("A road route could not be measured from the last location to Head Office; no entry was added.");
  }
  const settings = await getSettings();
  const vehicleType = employee.vehicleType as VehicleType;
  const amount = computeLegAmount(route.distanceKm, vehicleType, settings.rates);
  const sequence = Math.max(...legs.map((leg) => leg.sequence)) + 1;

  console.table([{
    employee: employee.name,
    date: WORK_DATE,
    route: `${origin.name} -> ${office.name}`,
    distanceKm: route.distanceKm,
    amount,
    vehicleType,
    source: route.source,
  }]);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add the return leg.");
    return;
  }

  const haversineKm = Math.round(haversineMeters(
    { lat: origin.latitude, lng: origin.longitude },
    { lat: office.latitude, lng: office.longitude },
  ) / 10) / 100;
  await prisma.journey.create({
    data: {
      employeeId: employee.id,
      workDate: WORK_DATE,
      fromSiteId: last.toSiteId,
      fromCustomLocationId: last.toCustomLocationId,
      toSiteId: office.id,
      fromName: origin.name,
      toName: office.name,
      fromAddress: origin.address,
      toAddress: office.address,
      fromLat: origin.latitude,
      fromLng: origin.longitude,
      toLat: office.latitude,
      toLng: office.longitude,
      locationType: "MASTER",
      sequence,
      loginAt: last.loginAt,
      distanceKm: route.distanceKm,
      roadKm: route.distanceKm,
      haversineKm,
      durationMin: Math.round(route.durationSeconds / 60),
      source: route.source,
      vehicleType: employee.vehicleType,
      amount,
    },
  });
  console.log(`Added Bharat Dash's ${WORK_DATE} return from ${origin.name} to ${office.name}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
