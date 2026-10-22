/** Correct Sultan's 21 October 2026 trip ending at Head Office to 22.3 km. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-21";
const OLD_DISTANCE_KM = 18.42;
const CONFIRMED_DISTANCE_KM = 22.3;
const REASON = "Manual distance confirmed by admin: 22.3 km.";

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Sultan", mode: "insensitive" } },
    select: { id: true, employeeCode: true, name: true, vehicleType: true },
  });
  if (employees.length !== 1) throw new Error(`Expected exactly one employee named Sultan; found ${employees.length}.`);
  const employee = employees[0];
  const office = await prisma.site.findFirstOrThrow({
    where: { isOffice: true, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const dayLegs = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE, toSiteId: office.id },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      fromName: true,
      toName: true,
      distanceKm: true,
      amount: true,
      vehicleType: true,
      source: true,
      manualDistance: true,
      distanceUpdated: true,
      distanceCorrection: { select: { id: true, status: true, finalDistanceKm: true } },
    },
  });
  const alreadyCorrected = dayLegs.filter((leg) => Math.abs(leg.distanceKm - CONFIRMED_DISTANCE_KM) < 0.001);
  if (dayLegs.length === 1 && alreadyCorrected.length === 1) {
    console.log("Sultan's 21 October Head Office trip is already 22.3 km; no changes made.");
    return;
  }
  const matches = dayLegs.filter((leg) => Math.abs(leg.distanceKm - OLD_DISTANCE_KM) < 0.001);
  if (matches.length !== 1) {
    throw new Error(`Expected one 18.42 km Sultan trip ending at Head Office; found:\n${JSON.stringify(dayLegs, null, 2)}`);
  }
  const journey = matches[0];
  if (journey.distanceCorrection && journey.distanceCorrection.status !== "APPROVED") {
    throw new Error(`Journey has an unresolved distance correction (${journey.distanceCorrection.status}); no changes made.`);
  }

  const settings = await getSettings();
  const amount = computeLegAmount(CONFIRMED_DISTANCE_KM, employee.vehicleType as VehicleType, settings.rates);
  console.table([{
    employee: `${employee.name} (${employee.employeeCode})`,
    date: WORK_DATE,
    trip: journey.sequence + 1,
    route: `${journey.fromName ?? "Unknown"} -> ${journey.toName ?? office.name}`,
    fromKm: journey.distanceKm,
    toKm: CONFIRMED_DISTANCE_KM,
    fromAmount: journey.amount,
    toAmount: amount,
  }]);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to save the corrected distance.");
    return;
  }

  const updatedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        distanceKm: CONFIRMED_DISTANCE_KM,
        amount,
        source: "MANUAL",
        manualDistance: true,
        manualReason: REASON,
        roadKm: null,
        durationMin: null,
        distanceUpdated: true,
        distanceUpdatedAt: updatedAt,
      },
    });
    if (journey.distanceCorrection?.status === "APPROVED") {
      await tx.distanceCorrection.update({
        where: { id: journey.distanceCorrection.id },
        data: { finalDistanceKm: CONFIRMED_DISTANCE_KM, reviewedAt: updatedAt },
      });
    }
  });
  console.log("Updated Sultan's 21 October Head Office trip to 22.3 km.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
