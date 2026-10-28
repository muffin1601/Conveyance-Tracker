/** Correct Sumit Yadav's 27 October 2026 GPS trip to Vasant Kunj to 24 km. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { ConveyanceRates } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-27";
const OLD_DISTANCE_KM = 22;
const CONFIRMED_DISTANCE_KM = 24;
const REASON = "Manual distance confirmed by admin: 24 km.";

async function main() {
  const employees = await prisma.employee.findMany({
    where: { name: { equals: "Sumit Yadav", mode: "insensitive" } },
    select: { id: true, name: true, employeeCode: true, vehicleType: true },
  });
  if (employees.length !== 1) throw new Error(`Expected one Sumit Yadav; found ${employees.length}.`);
  const employee = employees[0];
  const dayEntries = await prisma.journey.findMany({
    where: {
      employeeId: employee.id,
      workDate: WORK_DATE,
    },
    select: {
      id: true, workDate: true, sequence: true, fromName: true, toName: true,
      toAddress: true, distanceKm: true, amount: true, vehicleType: true,
      locationType: true,
      distanceCorrection: { select: { id: true, status: true } },
    },
  });
  const includesVasantKunj = (value: string | null) => value?.toLocaleLowerCase().includes("vasant kunj") ?? false;
  const vasantEntries = dayEntries.filter((entry) => entry.locationType === "GPS"
    && (includesVasantKunj(entry.toName) || includesVasantKunj(entry.toAddress)));
  const alreadyCorrected = vasantEntries.filter((entry) => Math.abs(entry.distanceKm - CONFIRMED_DISTANCE_KM) < 0.001);
  if (vasantEntries.length === 1 && alreadyCorrected.length === 1) {
    console.table(alreadyCorrected.map((entry) => ({
      employee: employee.name,
      date: entry.workDate,
      destination: entry.toName,
      distanceKm: entry.distanceKm,
      amount: entry.amount,
    })));
    console.log("Verified: entry already has the confirmed distance.");
    return;
  }
  // The UI shows one decimal place, so a stored 22.04 km appears as 22.0 km.
  const entries = vasantEntries.filter((entry) => Math.abs(entry.distanceKm - OLD_DISTANCE_KM) < 0.05);
  if (entries.length !== 1) {
    console.log("Journeys for this employee and date:", JSON.stringify(dayEntries, null, 2));
    throw new Error(`Expected one 22 km GPS entry for Vasant Kunj on ${WORK_DATE}; found ${entries.length}.`);
  }
  const journey = entries[0];
  if (journey.distanceCorrection && journey.distanceCorrection.status !== "APPROVED") {
    throw new Error(`Entry has an unresolved distance correction (${journey.distanceCorrection.status}); no changes made.`);
  }

  const settingsRow = await prisma.setting.findUnique({ where: { key: "company" }, select: { value: true } });
  const savedRates = settingsRow ? (JSON.parse(settingsRow.value) as { rates?: Partial<ConveyanceRates> }).rates : undefined;
  const rates: ConveyanceRates = {
    BIKE: 4, CAR: 11, CAB: 0, AUTO: 0, METRO: 0, BUS: 0,
    metroFlat: 60, busFlat: 30, busMetroPerKm: 3,
    ...savedRates,
  };
  const amount = employee.vehicleType === "BIKE" ? CONFIRMED_DISTANCE_KM * rates.BIKE
    : employee.vehicleType === "CAR" ? CONFIRMED_DISTANCE_KM * rates.CAR
    : employee.vehicleType === "METRO" ? rates.metroFlat
    : employee.vehicleType === "BUS" ? rates.busFlat
    : 0;
  console.table([{
    employee: `${employee.name} (${employee.employeeCode})`,
    date: journey.workDate,
    route: `${journey.fromName ?? "Unknown"} -> ${journey.toName ?? "Destination"}`,
    address: journey.toAddress,
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
  console.log(`Updated Sumit Yadav's ${WORK_DATE} Vasant Kunj trip to ${CONFIRMED_DISTANCE_KM} km.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
