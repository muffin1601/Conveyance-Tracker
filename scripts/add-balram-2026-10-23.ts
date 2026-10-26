/** Add Balram's 23 October 2026 Maini Farm <-> Head Office conveyance legs. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { calculateRoadDistance, isRoadDistance } from "../src/lib/routing";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-23";

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function main() {
  const employee = await exactlyOne(await prisma.employee.findMany({
    where: { name: { equals: "Balram", mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true },
  }), "employee named Balram");
  const office = await exactlyOne(await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Head Office");
  const mainiFarm = await exactlyOne(await prisma.site.findMany({
    where: { name: { equals: "MAINI FARM", mode: "insensitive" }, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Maini Farm site");

  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, fromSiteId: true, toSiteId: true, fromName: true, toName: true },
  });
  const outbound = existing.find((leg) => leg.fromSiteId === mainiFarm.id && leg.toSiteId === office.id);
  const inbound = existing.find((leg) => leg.fromSiteId === office.id && leg.toSiteId === mainiFarm.id);
  if (outbound && inbound && inbound.sequence === outbound.sequence + 1) {
    console.log("Balram's requested 23 October Maini Farm round trip already exists; no changes made.");
    return;
  }
  if (outbound || inbound) {
    throw new Error(`One of the requested legs already exists on ${WORK_DATE}; refusing to create a duplicate: ${JSON.stringify(existing)}`);
  }
  const firstSequence = existing.length ? Math.max(...existing.map((leg) => leg.sequence)) + 1 : 0;

  const settings = await getSettings();
  const routes = await Promise.all([
    calculateRoadDistance({ origin: mainiFarm, destination: office }),
    calculateRoadDistance({ origin: office, destination: mainiFarm }),
  ]);
  if (routes.some((route) => !isRoadDistance(route.source) || !route.routeAvailable)) {
    throw new Error("A road route could not be measured for both legs; no entries were created.");
  }
  const endpoints = [
    { from: mainiFarm, to: office },
    { from: office, to: mainiFarm },
  ];
  const vehicleType = employee.vehicleType as VehicleType;
  const entries = routes.map((route, sequence) => ({
    ...endpoints[sequence],
    route,
    sequence: firstSequence + sequence,
    amount: computeLegAmount(route.distanceKm, vehicleType, settings.rates),
  }));
  console.table(entries.map(({ from, to, route, amount }) => ({
    date: WORK_DATE, employee: employee.name, route: `${from.name} -> ${to.name}`,
    distanceKm: route.distanceKm, amount, source: route.source,
  })));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add these two legs.");
    return;
  }

  await prisma.$transaction(entries.map(({ from, to, route, sequence, amount }) =>
    prisma.journey.create({
      data: {
        employeeId: employee.id,
        workDate: WORK_DATE,
        fromSiteId: from.id,
        toSiteId: to.id,
        fromName: from.name,
        toName: to.name,
        fromAddress: from.address,
        toAddress: to.address,
        fromLat: from.latitude,
        fromLng: from.longitude,
        toLat: to.latitude,
        toLng: to.longitude,
        locationType: "MASTER",
        sequence,
        distanceKm: route.distanceKm,
        roadKm: route.distanceKm,
        haversineKm: Math.round(haversineMeters(
          { lat: from.latitude, lng: from.longitude },
          { lat: to.latitude, lng: to.longitude },
        ) / 10) / 100,
        durationMin: Math.round(route.durationSeconds / 60),
        source: route.source,
        vehicleType,
        amount,
      },
    }),
  ));
  console.log("Added Balram's 23 October Maini Farm -> Head Office -> Maini Farm trip.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
