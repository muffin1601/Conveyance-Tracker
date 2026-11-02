/** Add Mohd Soyab's Head Office -> the supplied Google Maps pin -> Head Office trip. */
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
const DESTINATION = {
  name: "South Delhi, Delhi",
  address: "South Delhi, Delhi 110038, India",
  latitude: 28.5272837,
  longitude: 77.1074793,
};

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function main() {
  const employee = await exactlyOne(await prisma.employee.findMany({
    where: { name: { contains: "soyab", mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true },
  }), "employee matching Soyab");
  const office = await exactlyOne(await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  }), "active Head Office");
  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: {
      id: true, sequence: true, fromSiteId: true, toSiteId: true,
      fromCustomLocationId: true, toCustomLocationId: true,
      fromName: true, toName: true, fromAddress: true, toAddress: true,
      fromLat: true, fromLng: true, toLat: true, toLng: true,
      distanceKm: true, loginAt: true,
    },
  });
  const atDestination = existing.filter((leg) =>
    (leg.fromLat === DESTINATION.latitude && leg.fromLng === DESTINATION.longitude) ||
    (leg.toLat === DESTINATION.latitude && leg.toLng === DESTINATION.longitude));
  const outbound = atDestination.find((leg) =>
    leg.fromSiteId === office.id && leg.toSiteId === null &&
    leg.toCustomLocationId === null &&
    leg.toLat === DESTINATION.latitude && leg.toLng === DESTINATION.longitude);
  const inbound = atDestination.find((leg) =>
    leg.toSiteId === office.id && leg.fromSiteId === null &&
    leg.fromCustomLocationId === null &&
    leg.fromLat === DESTINATION.latitude && leg.fromLng === DESTINATION.longitude);
  if (atDestination.length === 2 && outbound && inbound && inbound.sequence === outbound.sequence + 1) {
    if (
      outbound.toName === DESTINATION.name && outbound.toAddress === DESTINATION.address &&
      inbound.fromName === DESTINATION.name && inbound.fromAddress === DESTINATION.address
    ) {
      console.log(`The ${WORK_DATE} round trip already has the resolved address; no changes made.`);
      return;
    }
    await prisma.$transaction([
      prisma.journey.update({
        where: { id: outbound.id },
        data: { toName: DESTINATION.name, toAddress: DESTINATION.address },
      }),
      prisma.journey.update({
        where: { id: inbound.id },
        data: { fromName: DESTINATION.name, fromAddress: DESTINATION.address },
      }),
    ]);
    console.log(`Updated the ${WORK_DATE} round trip with the resolved address: ${DESTINATION.address}.`);
    return;
  }
  if (atDestination.length) {
    throw new Error(`One or more entries for this map pin already exist with different details; refusing to duplicate them:\n${JSON.stringify(atDestination, null, 2)}`);
  }

  const last = existing.at(-1);
  if (last && last.toSiteId !== office.id) {
    throw new Error(`The last recorded trip ends at ${last.toName ?? "an unrecognized location"}, not Head Office. Refusing to break the day's route sequence.`);
  }

  const fromOffice = {
    latitude: office.latitude,
    longitude: office.longitude,
  };
  const toLocation = {
    latitude: DESTINATION.latitude,
    longitude: DESTINATION.longitude,
  };
  const [outboundRoute, returnRoute] = await Promise.all([
    calculateRoadDistance({ origin: fromOffice, destination: toLocation }),
    calculateRoadDistance({ origin: toLocation, destination: fromOffice }),
  ]);
  if (!isRoadDistance(outboundRoute.source) || !outboundRoute.routeAvailable ||
      !isRoadDistance(returnRoute.source) || !returnRoute.routeAvailable) {
    throw new Error("A road route could not be measured in both directions; no entries were added.");
  }

  const settings = await getSettings();
  const vehicleType = employee.vehicleType as VehicleType;
  const legs = [
    { outbound: true, fromName: office.name, toName: DESTINATION.name, fromAddress: office.address, toAddress: DESTINATION.address, from: fromOffice, to: toLocation, route: outboundRoute },
    { outbound: false, fromName: DESTINATION.name, toName: office.name, fromAddress: DESTINATION.address, toAddress: office.address, from: toLocation, to: fromOffice, route: returnRoute },
  ].map((leg, index) => ({
    ...leg,
    sequence: (last?.sequence ?? -1) + index + 1,
    amount: computeLegAmount(leg.route.distanceKm, vehicleType, settings.rates),
  }));

  console.table(legs.map((leg) => ({
    date: WORK_DATE,
    employee: employee.name,
    route: `${leg.fromName} -> ${leg.toName}`,
    distanceKm: leg.route.distanceKm,
    amount: leg.amount,
    vehicleType,
    source: leg.route.source,
  })));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add both legs.");
    return;
  }

  const entries = legs.map((leg) => ({
    employeeId: employee.id,
    workDate: WORK_DATE,
    fromSiteId: leg.outbound ? office.id : null,
    toSiteId: leg.outbound ? null : office.id,
    fromName: leg.fromName,
    toName: leg.toName,
    fromAddress: leg.fromAddress,
    toAddress: leg.toAddress,
    fromLat: leg.from.latitude,
    fromLng: leg.from.longitude,
    toLat: leg.to.latitude,
    toLng: leg.to.longitude,
    locationType: "GPS",
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
  }));
  await prisma.$transaction(entries.map((data) => prisma.journey.create({ data })));
  console.log(`Added both ${WORK_DATE} legs for ${employee.name}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
