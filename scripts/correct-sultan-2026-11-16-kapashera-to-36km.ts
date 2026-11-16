/** Correct Sultan's 16 November Head Office -> Kapashera trip to 36 km. */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNEY_ID = "cmwitfvzs0006la085c476k0z";
const WORK_DATE = "2026-11-16";
const OLD_DISTANCE_KM = 29.8;
const NEW_DISTANCE_KM = 36;
const REASON = "Distance corrected to 36 km as requested by administrator on 16 November 2026.";

async function target(db: PrismaClient | Prisma.TransactionClient) {
  const journey = await db.journey.findUnique({
    where: { id: JOURNEY_ID },
    include: {
      employee: { select: { name: true, employeeCode: true } },
      distanceCorrection: { select: { id: true } },
      claimItem: { select: { claimId: true } },
    },
  });
  if (!journey || journey.employee.name !== "Sultan" || journey.workDate !== WORK_DATE ||
      journey.fromName !== "Watcon International — Head Office" ||
      journey.toName !== "Kapashera, Delhi" || journey.vehicleType !== "BIKE" ||
      journey.sequence !== 0) {
    throw new Error("The expected Sultan journey is missing or has changed.");
  }
  if (journey.distanceCorrection || journey.claimItem) {
    throw new Error("The journey has a correction or claim; review before changing it.");
  }
  const manualOverride = journey.distanceKm === NEW_DISTANCE_KM && journey.manualReason === REASON;
  const alreadyCorrected = manualOverride && journey.submittedDistanceKm == null &&
    journey.verifiedDistanceKm == null && journey.verifiedRouteMatch == null;
  if (!manualOverride && (journey.distanceKm !== OLD_DISTANCE_KM ||
      journey.submittedDistanceKm !== 28.24 || journey.verifiedDistanceKm !== 29.8)) {
    throw new Error("The journey distance or verified-route history changed; no update made.");
  }
  return { journey, alreadyCorrected, manualOverride };
}

async function main() {
  const { journey, alreadyCorrected, manualOverride } = await target(prisma);
  const amount = computeLegAmount(NEW_DISTANCE_KM, "BIKE", (await getSettings()).rates);
  console.table([{
    employee: `${journey.employee.name} (${journey.employee.employeeCode})`,
    date: WORK_DATE, route: `${journey.fromName} -> ${journey.toName}`,
    previousKm: journey.distanceKm, correctedKm: NEW_DISTANCE_KM,
    previousAmount: journey.amount, correctedAmount: amount,
    action: alreadyCorrected ? "already corrected" : manualOverride ? "clear stale badge" : APPLY ? "update" : "dry run",
  }]);
  if (alreadyCorrected || !APPLY) return;

  await prisma.$transaction(async (tx) => {
    const current = await target(tx);
    if (current.alreadyCorrected) return;
    await tx.journey.update({
      where: { id: JOURNEY_ID },
      data: {
        distanceKm: NEW_DISTANCE_KM, amount,
        source: "MANUAL", manualDistance: true, manualReason: REASON,
        roadKm: null, durationMin: null,
        submittedDistanceKm: null, verifiedDistanceKm: null,
        verifiedDiscrepancyKm: null, verifiedRouteMatch: null,
        distanceUpdated: true, distanceUpdatedAt: new Date(),
      },
    });
    await tx.auditLog.create({ data: {
      action: "UPDATE", entity: "Journey", entityId: JOURNEY_ID,
      meta: JSON.stringify({ source: "admin-distance-correction-script",
        employeeId: current.journey.employeeId, workDate: WORK_DATE,
        previousDistanceKm: current.journey.distanceKm, correctedDistanceKm: NEW_DISTANCE_KM,
        originalSubmittedDistanceKm: current.journey.submittedDistanceKm,
        originalVerifiedDistanceKm: current.journey.verifiedDistanceKm,
        previousAmount: current.journey.amount, correctedAmount: amount, reason: REASON }),
    } });
  });
  console.log("Updated Sultan's 16 November Kapashera trip to 36 km.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
