/** Restore Vijay Kumar's 13 November Stonex Peeragarhi journey to 30 km. */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNEY_ID = "cmweg16rf0001l907730238pv";
const CORRECTION_ID = "cmweidkxe0003jp080atx1l7i";
const WORK_DATE = "2026-11-13";
const DISTANCE_KM = 30;
const NOTE = "Admin restored this journey to 30 km as requested on 13 November 2026.";

async function getTarget(db: PrismaClient | Prisma.TransactionClient) {
  const journey = await db.journey.findUnique({
    where: { id: JOURNEY_ID },
    include: {
      employee: { select: { name: true, employeeCode: true } },
      distanceCorrection: { select: { id: true, status: true, originalDistanceKm: true,
        submittedDistanceKm: true, finalDistanceKm: true, adminNote: true } },
      claimItem: { select: { claimId: true } },
    },
  });
  if (!journey || journey.employee.name !== "Vijay Kumar" || journey.workDate !== WORK_DATE ||
      journey.toName !== "STONEX PEERAGARHI" || journey.vehicleType !== "BIKE") {
    throw new Error("The expected Vijay Kumar bike journey to Stonex Peeragarhi is missing or has changed.");
  }
  if (journey.claimItem) throw new Error(`Journey is attached to claim ${journey.claimItem.claimId}; review before changing it.`);
  const correction = journey.distanceCorrection;
  if (!correction || correction.id !== CORRECTION_ID || correction.status !== "APPROVED" ||
      correction.originalDistanceKm !== 30 || correction.submittedDistanceKm !== 23) {
    throw new Error("The approved 30-to-23 km correction is missing or has changed.");
  }
  const alreadyCorrected = journey.distanceKm === DISTANCE_KM && correction.finalDistanceKm === DISTANCE_KM &&
    correction.adminNote?.includes(NOTE);
  if (!alreadyCorrected && (journey.distanceKm !== 23 || correction.finalDistanceKm !== 23 || journey.roadKm !== 30)) {
    throw new Error("Journey distance, approved correction, or original road distance changed; no update made.");
  }
  return { journey, correction, alreadyCorrected };
}

async function main() {
  const { journey, alreadyCorrected } = await getTarget(prisma);
  const amount = computeLegAmount(DISTANCE_KM, "BIKE", (await getSettings()).rates);
  console.table([{ employee: `${journey.employee.name} (${journey.employee.employeeCode})`,
    date: WORK_DATE, route: `${journey.fromName} -> ${journey.toName}`,
    previousKm: journey.distanceKm, correctedKm: DISTANCE_KM,
    previousAmount: journey.amount, correctedAmount: amount,
    action: alreadyCorrected ? "already corrected" : APPLY ? "update" : "dry run" }]);
  if (alreadyCorrected || !APPLY) return;

  await prisma.$transaction(async (tx) => {
    const current = await getTarget(tx);
    if (current.alreadyCorrected) return;
    const updatedAt = new Date();
    await tx.journey.update({
      where: { id: JOURNEY_ID },
      data: { distanceKm: DISTANCE_KM, amount, source: "CACHE", manualDistance: false,
        manualReason: null, distanceUpdated: true, distanceUpdatedAt: updatedAt },
    });
    await tx.distanceCorrection.update({
      where: { id: CORRECTION_ID },
      data: { finalDistanceKm: DISTANCE_KM,
        adminNote: [current.correction.adminNote, NOTE].filter(Boolean).join("\n") },
    });
    await tx.auditLog.create({ data: {
      action: "UPDATE", entity: "Journey", entityId: JOURNEY_ID,
      meta: JSON.stringify({ source: "admin-distance-correction-script", workDate: WORK_DATE,
        correctionId: CORRECTION_ID, previousDistanceKm: current.journey.distanceKm,
        correctedDistanceKm: DISTANCE_KM, previousAmount: current.journey.amount,
        correctedAmount: amount, reason: NOTE }),
    } });
  });
  console.log("Updated Vijay Kumar's 13 November Stonex Peeragarhi journey to 30 km.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
