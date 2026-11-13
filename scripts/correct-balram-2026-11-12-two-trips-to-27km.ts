import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-11-12";
const CORRECTED_DISTANCE_KM = 27;
const REASON = "Distance corrected to 27 km as requested by administrator.";
const TARGETS = [
  { toName: "Okhla Phase - II, Delhi", displayedDistanceKm: 20.8 },
  { toName: "Najafgarh, Delhi", displayedDistanceKm: 21.0 },
] as const;

async function findTargets(db: PrismaClient | Prisma.TransactionClient) {
  const employees = await db.employee.findMany({
    where: { name: { equals: "Balram", mode: "insensitive" }, deletedAt: null },
    select: { id: true, name: true, employeeCode: true },
  });
  if (employees.length !== 1) {
    throw new Error(`Expected exactly one active Balram record; found ${employees.length}.`);
  }
  const employee = employees[0];
  const results = [];

  for (const target of TARGETS) {
    const entries = await db.journey.findMany({
      where: {
        employeeId: employee.id,
        workDate: WORK_DATE,
        toName: { equals: target.toName, mode: "insensitive" },
        OR: [
          { distanceKm: { gte: target.displayedDistanceKm - 0.05, lt: target.displayedDistanceKm + 0.05 } },
          { distanceKm: CORRECTED_DISTANCE_KM, manualReason: REASON },
        ],
      },
      include: {
        distanceCorrection: { select: { status: true } },
        claimItem: { select: { claimId: true } },
      },
    });
    if (entries.length !== 1) {
      throw new Error(`Expected exactly one trip ending at ${target.toName}; found ${entries.length}.`);
    }

    const journey = entries[0];
    const alreadyCorrected = journey.distanceKm === CORRECTED_DISTANCE_KM && journey.manualReason === REASON;
    if (!alreadyCorrected && Math.round(journey.distanceKm * 10) / 10 !== target.displayedDistanceKm) {
      throw new Error(`${target.toName} is ${journey.distanceKm} km, not the displayed ${target.displayedDistanceKm} km.`);
    }
    if (journey.distanceCorrection) {
      throw new Error(`${target.toName} has a ${journey.distanceCorrection.status} correction; refusing a conflicting update.`);
    }
    if (journey.claimItem) {
      throw new Error(`${target.toName} is attached to claim ${journey.claimItem.claimId}; refusing to alter a submitted claim.`);
    }
    if (journey.vehicleType !== "BIKE") {
      throw new Error(`Expected a BIKE trip for ${target.toName}; found ${journey.vehicleType}.`);
    }
    results.push({ journey, alreadyCorrected });
  }

  return { employee, results };
}

async function main() {
  const { employee, results } = await findTargets(prisma);
  const settings = await getSettings();
  const amount = computeLegAmount(CORRECTED_DISTANCE_KM, "BIKE", settings.rates);

  console.table(results.map(({ journey, alreadyCorrected }) => ({
    id: journey.id,
    employee: `${employee.name} (${employee.employeeCode})`,
    date: WORK_DATE,
    route: `${journey.fromName} -> ${journey.toName}`,
    previousKm: journey.distanceKm,
    correctedKm: CORRECTED_DISTANCE_KM,
    previousAmount: journey.amount,
    correctedAmount: amount,
    action: alreadyCorrected ? "already corrected" : APPLY ? "update" : "dry run",
  })));
  if (results.every(({ alreadyCorrected }) => alreadyCorrected)) return;
  if (!APPLY) return;

  await prisma.$transaction(async (tx) => {
    const current = await findTargets(tx);
    for (const { journey, alreadyCorrected } of current.results) {
      if (alreadyCorrected) continue;
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
          distanceUpdatedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          entity: "Journey",
          entityId: journey.id,
          meta: JSON.stringify({
            source: "admin-distance-correction-script",
            employeeId: current.employee.id,
            workDate: WORK_DATE,
            route: `${journey.fromName} -> ${journey.toName}`,
            previousDistanceKm: journey.distanceKm,
            correctedDistanceKm: CORRECTED_DISTANCE_KM,
            previousAmount: journey.amount,
            correctedAmount: amount,
            reason: REASON,
          }),
        },
      });
    }
  });
  console.log(`Updated Balram's two ${WORK_DATE} trips to ${CORRECTED_DISTANCE_KM} km each.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
