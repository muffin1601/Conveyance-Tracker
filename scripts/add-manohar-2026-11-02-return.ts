/** Add Manohar's 2 November 2026 return from South, Delhi to Head Office. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-02";
const OUTBOUND_ID = "cmvz63hjp000gl5087zu47xmi";

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Manohar", mode: "insensitive" }, deletedAt: null },
    select: { id: true, name: true, vehicleType: true },
  });
  if (employees.length !== 1) throw new Error(`Expected one active Manohar; found ${employees.length}.`);
  const employee = employees[0];

  const offices = await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  });
  if (offices.length !== 1) throw new Error(`Expected one active Head Office; found ${offices.length}.`);
  const office = offices[0];

  const journeys = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: {
      id: true, sequence: true, fromSiteId: true, toSiteId: true,
      fromCustomLocationId: true, toCustomLocationId: true,
      fromName: true, toName: true, fromAddress: true, toAddress: true,
      fromLat: true, fromLng: true, toLat: true, toLng: true, loginAt: true,
    },
  });
  const outbound = journeys.find((journey) => journey.id === OUTBOUND_ID);
  if (!outbound || outbound.fromSiteId !== office.id || outbound.toSiteId !== null ||
      outbound.toName !== "South, Delhi" || outbound.toLat == null || outbound.toLng == null) {
    throw new Error("The expected Head Office to South, Delhi trip is missing or has changed.");
  }
  const following = journeys.filter((journey) => journey.sequence > outbound.sequence);
  if (following.length === 1 && following[0].toSiteId === office.id &&
      following[0].fromLat === outbound.toLat && following[0].fromLng === outbound.toLng) {
    console.log("Manohar's South, Delhi return to Head Office already exists; no changes made.");
    return;
  }
  if (following.length) throw new Error("Other trips follow the target trip; refusing to append a conflicting return.");

  const origin = { latitude: outbound.toLat, longitude: outbound.toLng };
  const key = `${origin.latitude.toFixed(5)},${origin.longitude.toFixed(5)}|${office.latitude.toFixed(5)},${office.longitude.toFixed(5)}`;
  const cached = await prisma.distanceCache.findUnique({ where: { key } });
  if (!cached) {
    throw new Error("No saved road route exists for South, Delhi to Head Office; no entry was added.");
  }
  const vehicleType = employee.vehicleType as VehicleType;
  const settings = await getSettings();
  const amount = computeLegAmount(cached.roadKm, vehicleType, settings.rates);
  console.table([{
    employee: employee.name, date: WORK_DATE,
    route: `${outbound.toName} -> ${office.name}`,
    distanceKm: cached.roadKm, amount, vehicleType, source: "CACHE",
  }]);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to add the return entry.");
    return;
  }

  const haversineKm = Math.round(haversineMeters(
    { lat: origin.latitude, lng: origin.longitude },
    { lat: office.latitude, lng: office.longitude },
  ) / 10) / 100;
  await prisma.$transaction(async (tx) => {
    const current = await tx.journey.findMany({
      where: { employeeId: employee.id, workDate: WORK_DATE },
      orderBy: { sequence: "desc" },
      take: 1,
      select: { id: true, sequence: true },
    });
    if (current[0]?.id !== OUTBOUND_ID) {
      throw new Error("Manohar's last 2 November trip changed during the update.");
    }
    await tx.journey.create({
      data: {
        employeeId: employee.id,
        workDate: WORK_DATE,
        fromSiteId: outbound.toSiteId,
        fromCustomLocationId: outbound.toCustomLocationId,
        toSiteId: office.id,
        fromName: outbound.toName,
        toName: office.name,
        fromAddress: outbound.toAddress,
        toAddress: office.address,
        fromLat: origin.latitude,
        fromLng: origin.longitude,
        toLat: office.latitude,
        toLng: office.longitude,
        locationType: "MASTER",
        sequence: current[0].sequence + 1,
        loginAt: outbound.loginAt,
        distanceKm: cached.roadKm,
        roadKm: cached.roadKm,
        haversineKm,
        durationMin: cached.durationMin,
        source: "CACHE",
        vehicleType: employee.vehicleType,
        amount,
      },
    });
  });
  console.log(`Added Manohar's ${WORK_DATE} return to Head Office.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
