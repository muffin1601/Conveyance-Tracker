/** Add Mohmd Soyab's Head Office -> Aseem Khurana -> Head Office trip at 18 km per leg. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
const DISTANCE_KM = 18;
const TOTAL_KM = 36;

async function exactlyOne<T>(rows: T[], label: string): Promise<T> {
  if (rows.length !== 1) throw new Error(`Expected exactly one ${label}; found ${rows.length}.`);
  return rows[0];
}

async function main() {
  if (!WORK_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(WORK_DATE)) {
    throw new Error("Pass the requested work date as --date=YYYY-MM-DD.");
  }
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
      where: { name: { equals: "ASEEM KHURANA", mode: "insensitive" }, status: "ACTIVE" },
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
    }), "active Aseem Khurana site"),
  ]);
  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: {
      id: true, sequence: true, fromSiteId: true, toSiteId: true,
      fromName: true, toName: true, distanceKm: true, amount: true, loginAt: true,
    },
  });
  const outbound = existing.filter((leg) => leg.fromSiteId === office.id && leg.toSiteId === destination.id);
  const inbound = existing.filter((leg) => leg.fromSiteId === destination.id && leg.toSiteId === office.id);
  if (outbound.length === 1 && inbound.length === 1 &&
      Math.abs(outbound[0].distanceKm - DISTANCE_KM) < 0.001 &&
      Math.abs(inbound[0].distanceKm - DISTANCE_KM) < 0.001 &&
      inbound[0].sequence === outbound[0].sequence + 1) {
    console.log(`The ${WORK_DATE} 18 km round trip already exists; no changes made.`);
    return;
  }
  if (outbound.length || inbound.length) {
    throw new Error(`One or both requested legs already exist with different details; refusing to duplicate them:\n${JSON.stringify(existing, null, 2)}`);
  }

  const lastLeg = existing.at(-1);
  if (lastLeg && lastLeg.toSiteId !== office.id) {
    throw new Error(`The last existing trip ends at ${lastLeg.toName ?? "an unrecognized location"}, not Head Office. Refusing to break the day's route sequence.`);
  }
  const firstSequence = lastLeg ? lastLeg.sequence + 1 : 0;
  const vehicleType = employee.vehicleType as VehicleType;
  const settings = await getSettings();
  const amount = computeLegAmount(DISTANCE_KM, vehicleType, settings.rates);
  const legs = [
    { from: office, to: destination, sequence: firstSequence },
    { from: destination, to: office, sequence: firstSequence + 1 },
  ];
  console.table(legs.map((leg) => ({
    date: WORK_DATE,
    employee: employee.name,
    route: `${leg.from.name} -> ${leg.to.name}`,
    distanceKm: DISTANCE_KM,
    amount,
    vehicleType,
    totalRoundTripKm: TOTAL_KM,
  })));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add both legs.");
    return;
  }

  const reason = "Manual distance confirmed by admin: 18 km each way (36 km round trip).";
  const entries = legs.map((leg) => ({
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
    loginAt: lastLeg?.loginAt ?? null,
    distanceKm: DISTANCE_KM,
    roadKm: null,
    haversineKm: Math.round(haversineMeters(
      { lat: leg.from.latitude, lng: leg.from.longitude },
      { lat: leg.to.latitude, lng: leg.to.longitude },
    ) / 10) / 100,
    durationMin: null,
    source: "MANUAL",
    manualDistance: true,
    manualReason: reason,
    vehicleType: employee.vehicleType,
    amount,
  }));
  await prisma.$transaction(entries.map((data) => prisma.journey.create({ data })));
  console.log(`Added both ${WORK_DATE} 18 km legs for Mohmd Soyab (36 km total).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
