import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-30";
const ORIGINAL_DISTANCE_KM = 21.52;
const CORRECTED_DISTANCE_KM = 25;
const REASON = "Distance corrected to 25 km as requested by administrator.";

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Balram", mode: "insensitive" }, deletedAt: null },
    select: { id: true, name: true, employeeCode: true },
  });
  if (employees.length !== 1) {
    throw new Error(`Expected exactly one active Balram record; found ${employees.length}.`);
  }
  const employee = employees[0];

  const entries = await prisma.journey.findMany({
    where: {
      employeeId: employee.id,
      workDate: WORK_DATE,
      toName: { equals: "South, Delhi", mode: "insensitive" },
    },
    include: {
      distanceCorrection: { select: { id: true, status: true } },
      claimItem: { select: { id: true, claimId: true } },
    },
  });
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one South, Delhi trip on ${WORK_DATE}; found ${entries.length}.`);
  }
  const journey = entries[0];

  if (journey.distanceKm === CORRECTED_DISTANCE_KM && journey.manualReason === REASON) {
    console.log("The trip already has the requested 25 km correction.");
    return;
  }
  if (Math.abs(journey.distanceKm - ORIGINAL_DISTANCE_KM) > 0.02) {
    throw new Error(`The trip is ${journey.distanceKm} km, not the expected original ${ORIGINAL_DISTANCE_KM} km.`);
  }
  if (journey.distanceCorrection) {
    throw new Error(`Trip has a ${journey.distanceCorrection.status} distance correction; refusing a conflicting update.`);
  }
  if (journey.claimItem) {
    throw new Error(`Trip is already attached to claim ${journey.claimItem.claimId}; refusing to alter a submitted claim.`);
  }
  if (journey.vehicleType !== "BIKE") {
    throw new Error(`Expected a BIKE trip from the screenshot; found ${journey.vehicleType}.`);
  }

  const settings = await getSettings();
  const amount = computeLegAmount(CORRECTED_DISTANCE_KM, "BIKE", settings.rates);
  console.table([{
    employee: `${employee.name} (${employee.employeeCode})`,
    date: journey.workDate,
    route: `${journey.fromName ?? "Unknown"} -> ${journey.toName}`,
    previousKm: journey.distanceKm,
    correctedKm: CORRECTED_DISTANCE_KM,
    previousAmount: journey.amount,
    correctedAmount: amount,
  }]);

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to save the corrected distance.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.journey.findUnique({
      where: { id: journey.id },
      include: {
        distanceCorrection: { select: { id: true, status: true } },
        claimItem: { select: { id: true, claimId: true } },
      },
    });
    if (
      !current ||
      Math.abs(current.distanceKm - ORIGINAL_DISTANCE_KM) > 0.02 ||
      current.distanceCorrection ||
      current.claimItem
    ) {
      throw new Error("Trip changed since inspection; no update was applied.");
    }

    const updatedAt = new Date();
    await tx.journey.update({
      where: { id: journey.id },
      data: {
        distanceKm: CORRECTED_DISTANCE_KM,
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
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Journey",
        entityId: journey.id,
        meta: JSON.stringify({
          source: "admin-distance-correction-script",
          employeeId: employee.id,
          workDate: WORK_DATE,
          previousDistanceKm: journey.distanceKm,
          correctedDistanceKm: CORRECTED_DISTANCE_KM,
          previousAmount: journey.amount,
          correctedAmount: amount,
          reason: REASON,
        }),
      },
    });
  });

  console.log(`Updated Balram's ${WORK_DATE} South, Delhi trip to ${CORRECTED_DISTANCE_KM} km.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
