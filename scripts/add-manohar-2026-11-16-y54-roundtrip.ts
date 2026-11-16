/** Add Manohar's 16 November Head Office <-> Y-54 bike round trip, 1 km each way. */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-16";
const DESTINATION = {
  name: "Y-54, Okhla Industrial Area Phase II",
  address: "Y-54, Okhla Industrial Area Phase II, New Delhi, Delhi 110020",
};
const REASON = "Admin-entered Head Office to Y-54 round trip: 1 km each way as requested.";
type Db = PrismaClient | Prisma.TransactionClient;

async function getDay(db: Db, employeeId: string) {
  return db.journey.findMany({
    where: { employeeId, workDate: WORK_DATE }, orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, fromName: true, toName: true, distanceKm: true,
      vehicleType: true, amount: true, manualReason: true, fromSiteId: true, toSiteId: true },
  });
}

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Manohar", mode: "insensitive" }, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, employeeCode: true, vehicleType: true },
  });
  if (employees.length !== 1 || employees[0].vehicleType !== "BIKE") {
    throw new Error("Expected one active Manohar with Bike as his vehicle.");
  }
  const employee = employees[0];
  const offices = await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  });
  if (offices.length !== 1) throw new Error(`Expected one active Head Office; found ${offices.length}.`);
  const office = offices[0];
  const day = await getDay(prisma, employee.id);
  const inserted = day.filter((leg) => leg.manualReason === REASON);
  if (inserted.length === 2 && day.length === 2 &&
      inserted[0].sequence === 0 && inserted[1].sequence === 1 &&
      inserted[0].fromSiteId === office.id && inserted[0].toName === DESTINATION.name &&
      inserted[1].fromName === DESTINATION.name && inserted[1].toSiteId === office.id &&
      inserted.every((leg) => leg.distanceKm === 1 && leg.vehicleType === "BIKE")) {
    console.table(inserted.map((leg) => ({ sequence: leg.sequence,
      route: `${leg.fromName} -> ${leg.toName}`, distanceKm: leg.distanceKm, amount: leg.amount })));
    console.log("Both requested Manohar journeys already exist; no changes made.");
    return;
  }
  if (day.length) throw new Error("Manohar already has journeys on 16 November; review before adding this round trip.");

  const amount = computeLegAmount(1, "BIKE", (await getSettings()).rates);
  const legs = [
    { sequence: 0, fromSiteId: office.id, toSiteId: null,
      fromName: office.name, toName: DESTINATION.name,
      fromAddress: office.address, toAddress: DESTINATION.address,
      fromLat: office.latitude, fromLng: office.longitude,
      toLat: null, toLng: null, locationType: "GPS" },
    { sequence: 1, fromSiteId: null, toSiteId: office.id,
      fromName: DESTINATION.name, toName: office.name,
      fromAddress: DESTINATION.address, toAddress: office.address,
      fromLat: null, fromLng: null,
      toLat: office.latitude, toLng: office.longitude, locationType: "MASTER" },
  ];
  console.table(legs.map((leg) => ({ employee: employee.name, date: WORK_DATE,
    sequence: leg.sequence, route: `${leg.fromName} -> ${leg.toName}`,
    vehicle: "BIKE", distanceKm: 1, amount, action: APPLY ? "add" : "dry run" })));
  if (!APPLY) return;

  await prisma.$transaction(async (tx) => {
    if ((await getDay(tx, employee.id)).length) throw new Error("Manohar's 16 November journeys changed; no entries were added.");
    for (const leg of legs) {
      const journey = await tx.journey.create({ data: {
        ...leg, employeeId: employee.id, workDate: WORK_DATE,
        distanceKm: 1, haversineKm: 1, roadKm: null, durationMin: null,
        source: "MANUAL", manualDistance: true, manualReason: REASON,
        vehicleType: "BIKE", amount,
      } });
      await tx.auditLog.create({ data: {
        action: "CREATE", entity: "Journey", entityId: journey.id,
        meta: JSON.stringify({ source: "admin-journey-script", employeeId: employee.id,
          workDate: WORK_DATE, route: `${leg.fromName} -> ${leg.toName}`,
          distanceKm: 1, vehicleType: "BIKE", amount, reason: REASON,
          destinationAddress: DESTINATION.address, destinationCoordinates: "unavailable" }),
      } });
    }
  });
  console.log("Added Manohar's 16 November Y-54 round trip (2 km total).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
