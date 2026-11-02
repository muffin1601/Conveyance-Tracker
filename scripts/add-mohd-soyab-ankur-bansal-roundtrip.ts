/** Add Mohmd Soyab's Head Office -> Ankur Bansal -> Head Office trip. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { calculateRoadDistance, isRoadDistance } from "../src/lib/routing";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-02";

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function main() {
  const employee = await exactlyOne(await prisma.employee.findMany({
    where: { name: { equals: "Mohmd Soyab", mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true },
  }), "employee named Mohmd Soyab");
  const [office, destination] = await Promise.all([
    exactlyOne(await prisma.site.findMany({
      where: { isOffice: true, status: "ACTIVE" },
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
    }), "active Head Office"),
    exactlyOne(await prisma.site.findMany({
      where: { name: { equals: "ANKUR BANSAL", mode: "insensitive" }, status: "ACTIVE" },
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
    }), "active Ankur Bansal site"),
  ]);
  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: {
      id: true, sequence: true, fromSiteId: true, toSiteId: true,
      fromCustomLocationId: true, toCustomLocationId: true,
      fromName: true, toName: true, loginAt: true, distanceKm: true,
    },
  });

  const outbound = existing.filter((leg) => leg.fromSiteId === office.id && leg.toSiteId === destination.id);
  const inbound = existing.filter((leg) => leg.fromSiteId === destination.id && leg.toSiteId === office.id);
  if (
    outbound.length === 1 && inbound.length === 1 &&
    outbound[0].fromCustomLocationId === null && outbound[0].toCustomLocationId === null &&
    inbound[0].fromCustomLocationId === null && inbound[0].toCustomLocationId === null &&
    inbound[0].sequence === outbound[0].sequence + 1
  ) {
    console.log(`The ${WORK_DATE} Ankur Bansal round trip already exists; no changes made.`);
    return;
  }
  if (outbound.length || inbound.length) {
    throw new Error(`One or both Ankur Bansal legs already exist with different details; refusing to duplicate:\n${JSON.stringify(existing, null, 2)}`);
  }

  const last = existing.at(-1);
  if (last && last.toSiteId !== office.id) {
    throw new Error(`The last recorded trip ends at ${last.toName ?? "an unrecognized location"}, not Head Office. Refusing to break the day's route sequence.`);
  }

  const [outboundRoute, returnRoute] = await Promise.all([
    calculateRoadDistance({
      origin: { latitude: office.latitude, longitude: office.longitude },
      destination: { latitude: destination.latitude, longitude: destination.longitude },
    }),
    calculateRoadDistance({
      origin: { latitude: destination.latitude, longitude: destination.longitude },
      destination: { latitude: office.latitude, longitude: office.longitude },
    }),
  ]);
  if (!isRoadDistance(outboundRoute.source) || !outboundRoute.routeAvailable ||
      !isRoadDistance(returnRoute.source) || !returnRoute.routeAvailable) {
    throw new Error("A road route could not be measured in both directions; no entries were added.");
  }

  const settings = await getSettings();
  const vehicleType = employee.vehicleType as VehicleType;
  const legs = [
    { from: office, to: destination, route: outboundRoute, sequence: (last?.sequence ?? -1) + 1 },
    { from: destination, to: office, route: returnRoute, sequence: (last?.sequence ?? -1) + 2 },
  ].map((leg) => ({
    ...leg,
    amount: computeLegAmount(leg.route.distanceKm, vehicleType, settings.rates),
  }));

  console.table(legs.map((leg) => ({
    date: WORK_DATE,
    employee: employee.name,
    route: `${leg.from.name} -> ${leg.to.name}`,
    distanceKm: leg.route.distanceKm,
    amount: leg.amount,
    vehicleType,
    source: leg.route.source,
    sequence: leg.sequence,
  })));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add both legs.");
    return;
  }

  await prisma.$transaction(legs.map((leg) => prisma.journey.create({
    data: {
      employeeId: employee.id,
      workDate: WORK_DATE,
      fromSiteId: leg.from.id,
      toSiteId: leg.to.id,
      fromName: leg.from.name,
      toName: leg.to.name,
      fromAddress: leg.from.address,
      toAddress: leg.to.address,
      fromLat: leg.from.latitude,
      fromLng: leg.from.longitude,
      toLat: leg.to.latitude,
      toLng: leg.to.longitude,
      locationType: "MASTER",
      sequence: leg.sequence,
      loginAt: last?.loginAt ?? null,
      distanceKm: leg.route.distanceKm,
      roadKm: leg.route.distanceKm,
      haversineKm: Math.round(haversineMeters(
        { lat: leg.from.latitude, lng: leg.from.longitude },
        { lat: leg.to.latitude, lng: leg.to.longitude },
      ) / 10) / 100,
      durationMin: Math.round(leg.route.durationSeconds / 60),
      source: leg.route.source,
      vehicleType: employee.vehicleType,
      amount: leg.amount,
    },
  })));
  console.log(`Added both ${WORK_DATE} Ankur Bansal legs for ${employee.name}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
