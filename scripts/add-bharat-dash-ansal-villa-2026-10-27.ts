/** Add Bharat Dash's 27 October 2026 Ansal Villa -> Head Office journey. */
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
  const ansalVilla = await exactlyOne(await prisma.site.findMany({
    where: { name: { contains: "Ansal Villa", mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Ansal Villa site");

  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, fromSiteId: true, toSiteId: true, fromName: true, toName: true },
  });
  if (existing.some((leg) => leg.fromSiteId === ansalVilla.id && leg.toSiteId === office.id)) {
    console.log("Bharat Dash's 27 October Ansal Villa -> Head Office entry already exists; no changes made.");
    return;
  }

  const route = await calculateRoadDistance({ origin: ansalVilla, destination: office });
  if (!isRoadDistance(route.source) || !route.routeAvailable) {
    throw new Error("A road route could not be measured; no entry was created.");
  }
  const settings = await getSettings();
  const vehicleType = employee.vehicleType as VehicleType;
  const amount = computeLegAmount(route.distanceKm, vehicleType, settings.rates);
  const sequence = existing.length ? Math.max(...existing.map((leg) => leg.sequence)) + 1 : 0;

  console.table([{
    date: WORK_DATE, employee: employee.name, route: `${ansalVilla.name} -> ${office.name}`,
    distanceKm: route.distanceKm, amount, source: route.source,
  }]);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add this entry.");
    return;
  }

  await prisma.journey.create({
    data: {
      employeeId: employee.id,
      workDate: WORK_DATE,
      fromSiteId: ansalVilla.id,
      toSiteId: office.id,
      fromName: ansalVilla.name,
      toName: office.name,
      fromAddress: ansalVilla.address,
      toAddress: office.address,
      fromLat: ansalVilla.latitude,
      fromLng: ansalVilla.longitude,
      toLat: office.latitude,
      toLng: office.longitude,
      locationType: "MASTER",
      sequence,
      distanceKm: route.distanceKm,
      roadKm: route.distanceKm,
      haversineKm: Math.round(haversineMeters(
        { lat: ansalVilla.latitude, lng: ansalVilla.longitude },
        { lat: office.latitude, lng: office.longitude },
      ) / 10) / 100,
      durationMin: Math.round(route.durationSeconds / 60),
      source: route.source,
      vehicleType,
      amount,
    },
  });
  console.log("Added Bharat Dash's 27 October Ansal Villa -> Head Office journey.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
