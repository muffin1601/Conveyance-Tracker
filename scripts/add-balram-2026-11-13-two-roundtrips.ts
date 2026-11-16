/** Add Balram's 13 November 2026 Sainik Farm and DLF Chhattarpur Farms round trips. */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-13";
const DLF = {
  name: "DLF Chhattarpur Farms",
  address: "DLF Farms, Chattarpur Farms, South, Delhi, South Delhi, Delhi, 110074, India",
  latitude: 28.4823661,
  longitude: 77.1724534,
};
const REASON = "Admin-entered round trips: Sainik Farm 12 km each way; DLF Chhattarpur Farms 24 km each way.";

type Db = PrismaClient | Prisma.TransactionClient;
async function getDay(db: Db, employeeId: string) {
  return db.journey.findMany({
    where: { employeeId, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, fromName: true, toName: true, distanceKm: true,
      vehicleType: true, amount: true, manualReason: true },
  });
}

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Balram", mode: "insensitive" }, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, employeeCode: true, vehicleType: true },
  });
  if (employees.length !== 1) throw new Error(`Expected one active Balram; found ${employees.length}.`);
  const employee = employees[0];
  if (employee.vehicleType !== "BIKE") throw new Error(`Balram's vehicle changed to ${employee.vehicleType}; review the fare.`);

  const [offices, sainikSites] = await Promise.all([
    prisma.site.findMany({ where: { isOffice: true, status: "ACTIVE" }, select: { id: true, name: true, address: true, latitude: true, longitude: true } }),
    prisma.site.findMany({ where: { name: "Sainik Farm", status: "ACTIVE", deletedAt: null }, select: { id: true, name: true, address: true, latitude: true, longitude: true } }),
  ]);
  if (offices.length !== 1 || sainikSites.length !== 1) throw new Error(`Expected one office and one Sainik Farm; found ${offices.length} and ${sainikSites.length}.`);
  const office = offices[0];
  const sainik = sainikSites[0];
  const day = await getDay(prisma, employee.id);
  const inserted = day.filter((leg) => leg.manualReason === REASON);
  const expected = [
    { from: office.name, to: sainik.name, km: 12 },
    { from: sainik.name, to: office.name, km: 12 },
    { from: office.name, to: DLF.name, km: 24 },
    { from: DLF.name, to: office.name, km: 24 },
  ];
  if (inserted.length === 4 && expected.every((leg, index) =>
    inserted[index].sequence === index && inserted[index].fromName === leg.from &&
    inserted[index].toName === leg.to && inserted[index].distanceKm === leg.km &&
    inserted[index].vehicleType === "BIKE")) {
    console.table(inserted.map(({ sequence, fromName, toName, distanceKm, vehicleType, amount }) =>
      ({ sequence, route: `${fromName} -> ${toName}`, distanceKm, vehicleType, amount })));
    console.log("All four requested journeys already exist; no changes made.");
    return;
  }
  if (inserted.length) throw new Error(`Found ${inserted.length} existing legs from this request; refusing a partial duplicate.`);
  if (day.length !== 4 || day.some((leg, index) => leg.sequence !== index) || day[0].fromName !== office.name) {
    throw new Error("Balram's existing November 13 route differs from the inspected four-leg day; review before inserting the round trips.");
  }

  const settings = await getSettings();
  const amount12 = computeLegAmount(12, "BIKE", settings.rates);
  const amount24 = computeLegAmount(24, "BIKE", settings.rates);
  console.table(expected.map((leg, index) => ({ sequence: index, date: WORK_DATE,
    employee: employee.name, route: `${leg.from} -> ${leg.to}`, vehicle: "BIKE",
    distanceKm: leg.km, amount: leg.km === 12 ? amount12 : amount24 })));
  console.log("The four existing journeys will move from sequences 0–3 to 4–7.");
  if (!APPLY) { console.log("Dry run only; pass --apply to save the four legs."); return; }

  const haversine = (destination: { latitude: number; longitude: number }) =>
    Math.round(haversineMeters(
      { lat: office.latitude, lng: office.longitude },
      { lat: destination.latitude, lng: destination.longitude },
    ) / 10) / 100;

  await prisma.$transaction(async (tx) => {
    const current = await getDay(tx, employee.id);
    if (current.length !== day.length || current.some((leg, index) => leg.id !== day[index].id || leg.sequence !== day[index].sequence)) {
      throw new Error("Balram's November 13 journeys changed during the update.");
    }
    const dlfLocation = await tx.userCustomLocation.create({
      data: { employeeId: employee.id, locationName: DLF.name, address: DLF.address,
        city: "New Delhi", state: "Delhi", country: "India",
        latitude: DLF.latitude, longitude: DLF.longitude, source: "MANUAL" },
    });
    for (const leg of current) {
      await tx.journey.update({ where: { id: leg.id }, data: { sequence: leg.sequence + 4 } });
    }
    const legs = [
      { sequence: 0, fromSiteId: office.id, toSiteId: sainik.id,
        fromName: office.name, toName: sainik.name,
        fromAddress: office.address, toAddress: sainik.address,
        fromLat: office.latitude, fromLng: office.longitude,
        toLat: sainik.latitude, toLng: sainik.longitude,
        locationType: "MASTER", distanceKm: 12, amount: amount12, haversineKm: haversine(sainik) },
      { sequence: 1, fromSiteId: sainik.id, toSiteId: office.id,
        fromName: sainik.name, toName: office.name,
        fromAddress: sainik.address, toAddress: office.address,
        fromLat: sainik.latitude, fromLng: sainik.longitude,
        toLat: office.latitude, toLng: office.longitude,
        locationType: "MASTER", distanceKm: 12, amount: amount12, haversineKm: haversine(sainik) },
      { sequence: 2, fromSiteId: office.id, toCustomLocationId: dlfLocation.id,
        fromName: office.name, toName: DLF.name,
        fromAddress: office.address, toAddress: DLF.address,
        fromLat: office.latitude, fromLng: office.longitude,
        toLat: DLF.latitude, toLng: DLF.longitude,
        locationType: "CUSTOM", distanceKm: 24, amount: amount24, haversineKm: haversine(DLF) },
      { sequence: 3, fromCustomLocationId: dlfLocation.id, toSiteId: office.id,
        fromName: DLF.name, toName: office.name,
        fromAddress: DLF.address, toAddress: office.address,
        fromLat: DLF.latitude, fromLng: DLF.longitude,
        toLat: office.latitude, toLng: office.longitude,
        locationType: "MASTER", distanceKm: 24, amount: amount24, haversineKm: haversine(DLF) },
    ];
    for (const leg of legs) {
      const journey = await tx.journey.create({ data: {
        ...leg, employeeId: employee.id, workDate: WORK_DATE,
        roadKm: null, durationMin: null, source: "MANUAL", manualDistance: true,
        manualReason: REASON, vehicleType: "BIKE",
      } });
      await tx.auditLog.create({ data: { action: "CREATE", entity: "Journey", entityId: journey.id,
        meta: JSON.stringify({ source: "admin-journey-script", employeeId: employee.id,
          workDate: WORK_DATE, route: `${leg.fromName} -> ${leg.toName}`,
          distanceKm: leg.distanceKm, vehicleType: "BIKE", amount: leg.amount, reason: REASON }) } });
    }
  });
  console.log("Added Balram's four requested November 13 journeys (72 km total).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
