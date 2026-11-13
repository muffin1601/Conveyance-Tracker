/** Add Jatin's 12 November 2026 Head Office <-> Jaipur car trip, 279.7 km each way. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import { haversineMeters } from "../src/lib/gps";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-12";
const DISTANCE_KM = 279.7;
const DESTINATION = {
  name: "Jaipur, Rajasthan",
  address: "Jaipur, Rajasthan, India",
  // City result for "Jaipur, Rajasthan, India" from the app's Nominatim geocoder.
  latitude: 26.9154576,
  longitude: 75.8189817,
};
const REASON = "Admin-entered Head Office to Jaipur round trip: 279.7 km each way by car.";

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Jatin", mode: "insensitive" }, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, employeeCode: true },
  });
  if (employees.length !== 1) throw new Error(`Expected one active Jatin; found ${employees.length}.`);
  const employee = employees[0];

  const offices = await prisma.site.findMany({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true, address: true, latitude: true, longitude: true },
  });
  if (offices.length !== 1) throw new Error(`Expected one active Head Office; found ${offices.length}.`);
  const office = offices[0];

  const existing = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, fromName: true, toName: true, distanceKm: true, vehicleType: true, amount: true },
  });
  if (existing.length === 2 &&
      existing[0].sequence === 0 && existing[1].sequence === 1 &&
      existing[0].fromName === office.name && existing[0].toName === DESTINATION.name &&
      existing[1].fromName === DESTINATION.name && existing[1].toName === office.name &&
      existing.every((leg) => leg.distanceKm === DISTANCE_KM && leg.vehicleType === "CAR")) {
    console.table(existing);
    console.log("Jatin's requested Jaipur round trip already exists; no changes made.");
    return;
  }
  if (existing.length) throw new Error(`Jatin already has ${existing.length} journey(s) on ${WORK_DATE}; review the day's route before adding this round trip.`);

  const settings = await getSettings();
  const amount = computeLegAmount(DISTANCE_KM, "CAR", settings.rates);
  console.table([
    { employee: employee.name, date: WORK_DATE, route: `${office.name} -> ${DESTINATION.name}`, vehicle: "CAR", distanceKm: DISTANCE_KM, amount },
    { employee: employee.name, date: WORK_DATE, route: `${DESTINATION.name} -> ${office.name}`, vehicle: "CAR", distanceKm: DISTANCE_KM, amount },
  ]);
  if (!APPLY) { console.log("Dry run only; pass --apply to save both legs."); return; }

  const haversineKm = Math.round(haversineMeters(
    { lat: office.latitude, lng: office.longitude },
    { lat: DESTINATION.latitude, lng: DESTINATION.longitude },
  ) / 10) / 100;

  await prisma.$transaction(async (tx) => {
    const current = await tx.journey.count({ where: { employeeId: employee.id, workDate: WORK_DATE } });
    if (current !== 0) throw new Error("Jatin's November 12 journeys changed during the update.");
    const location = await tx.userCustomLocation.create({
      data: {
        employeeId: employee.id,
        locationName: DESTINATION.name,
        address: DESTINATION.address,
        city: "Jaipur",
        state: "Rajasthan",
        country: "India",
        latitude: DESTINATION.latitude,
        longitude: DESTINATION.longitude,
        source: "MANUAL",
      },
    });
    const legs = [
      {
        sequence: 0, fromSiteId: office.id, toCustomLocationId: location.id,
        fromName: office.name, toName: DESTINATION.name,
        fromAddress: office.address, toAddress: DESTINATION.address,
        fromLat: office.latitude, fromLng: office.longitude,
        toLat: DESTINATION.latitude, toLng: DESTINATION.longitude,
        locationType: "CUSTOM",
      },
      {
        sequence: 1, fromCustomLocationId: location.id, toSiteId: office.id,
        fromName: DESTINATION.name, toName: office.name,
        fromAddress: DESTINATION.address, toAddress: office.address,
        fromLat: DESTINATION.latitude, fromLng: DESTINATION.longitude,
        toLat: office.latitude, toLng: office.longitude,
        locationType: "MASTER",
      },
    ];
    for (const leg of legs) {
      const journey = await tx.journey.create({
        data: {
          ...leg, employeeId: employee.id, workDate: WORK_DATE,
          distanceKm: DISTANCE_KM, roadKm: null, haversineKm, durationMin: null,
          source: "MANUAL", manualDistance: true, manualReason: REASON,
          vehicleType: "CAR", amount,
        },
      });
      await tx.auditLog.create({
        data: { action: "CREATE", entity: "Journey", entityId: journey.id,
          meta: JSON.stringify({ source: "admin-journey-script", employeeId: employee.id,
            workDate: WORK_DATE, route: `${leg.fromName} -> ${leg.toName}`,
            distanceKm: DISTANCE_KM, vehicleType: "CAR", amount, reason: REASON }) },
      });
    }
  });
  console.log("Added both Jatin car journeys for 12 November 2026 (559.4 km total).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
