/** Correct Bharat Dash's 30 October 2026 Aseem Khurana entry to 13 km. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-30";
const CURRENT_DISTANCE_KM = 1.8;
const CONFIRMED_DISTANCE_KM = 13;
const REASON = "Manual distance confirmed by admin: 13 km.";

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Bharat Dash", mode: "insensitive" } },
    select: { id: true, name: true, employeeCode: true, vehicleType: true },
  });
  if (employees.length !== 1) {
    throw new Error(`Expected exactly one employee named Bharat Dash; found ${employees.length}.`);
  }
  const employee = employees[0];
  const dayEntries = await prisma.journey.findMany({
    where: { employeeId: employee.id, workDate: WORK_DATE },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      sequence: true,
      fromName: true,
      toName: true,
      distanceKm: true,
      amount: true,
      vehicleType: true,
      distanceCorrection: {
        select: { id: true, status: true, finalDistanceKm: true, adminNote: true },
      },
    },
  });
  const entries = dayEntries.filter((entry) =>
    entry.toName?.toLocaleLowerCase().includes("aseem khurana")
  );
  const targetEntries = entries.filter(
    (entry) =>
      Math.abs(entry.distanceKm - CURRENT_DISTANCE_KM) < 0.05 ||
      Math.abs(entry.distanceKm - CONFIRMED_DISTANCE_KM) < 0.001
  );
  if (targetEntries.length !== 1) {
    throw new Error(
      `Expected exactly one Bharat Dash entry to Aseem Khurana on ${WORK_DATE} near ` +
        `${CURRENT_DISTANCE_KM} km (or already ${CONFIRMED_DISTANCE_KM} km); found ${targetEntries.length}:\n` +
        JSON.stringify(entries, null, 2)
    );
  }

  const journey = targetEntries[0];
  if (Math.abs(journey.distanceKm - CONFIRMED_DISTANCE_KM) < 0.001) {
    console.log("The Bharat Dash Aseem Khurana entry is already 13 km; no changes made.");
    return;
  }
  if (
    journey.distanceCorrection &&
    journey.distanceCorrection.status !== "APPROVED"
  ) {
    throw new Error(
      `Entry has an unresolved/rejected correction (${journey.distanceCorrection.status}); no changes made.`
    );
  }

  const settings = await getSettings();
  const vehicleType = journey.vehicleType as VehicleType;
  const amount = ["BIKE", "CAR"].includes(vehicleType)
    ? computeLegAmount(CONFIRMED_DISTANCE_KM, vehicleType, settings.rates)
    : journey.amount;
  console.table([{
    employee: `${employee.name} (${employee.employeeCode})`,
    date: WORK_DATE,
    time: journey.createdAt.toLocaleTimeString(),
    route: `${journey.fromName ?? "Unknown"} -> ${journey.toName}`,
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
        data: {
          finalDistanceKm: CONFIRMED_DISTANCE_KM,
          reviewedAt: updatedAt,
          adminNote: [
            journey.distanceCorrection.adminNote,
            `Manual distance update: ${journey.distanceCorrection.finalDistanceKm} km -> ${CONFIRMED_DISTANCE_KM} km.`,
          ].filter(Boolean).join("\n"),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Journey",
        entityId: journey.id,
        meta: JSON.stringify({
          reason: "admin-confirmed-distance-update",
          employeeId: employee.id,
          workDate: WORK_DATE,
          fromName: journey.fromName,
          toName: journey.toName,
          previousDistanceKm: journey.distanceKm,
          updatedDistanceKm: CONFIRMED_DISTANCE_KM,
          correctionId: journey.distanceCorrection?.id ?? null,
        }),
      },
    });
  });
  console.log(`Updated Bharat Dash's ${WORK_DATE} Aseem Khurana entry to ${CONFIRMED_DISTANCE_KM} km.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
