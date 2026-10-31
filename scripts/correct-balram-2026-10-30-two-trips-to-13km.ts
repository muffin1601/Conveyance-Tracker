import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WORK_DATE = "2026-10-30";
const CORRECTED_DISTANCE_KM = 13;
const TARGETS = [
  {
    fromName: "Okhla Phase - II, Delhi",
    toName: "Golf Links, New Delhi",
    originalDistanceKm: 10.63,
  },
  {
    fromName: "Golf Links, New Delhi",
    toName: "Watcon International — Head Office",
    originalDistanceKm: 9.81,
  },
] as const;

async function findTargets(db: typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
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
        fromName: { equals: target.fromName, mode: "insensitive" },
        toName: { equals: target.toName, mode: "insensitive" },
      },
      include: {
        distanceCorrection: { select: { id: true, status: true } },
        claimItem: { select: { id: true, claimId: true } },
      },
    });
    if (entries.length !== 1) {
      throw new Error(`Expected exactly one ${target.fromName} -> ${target.toName} trip; found ${entries.length}.`);
    }

    const journey = entries[0];
    if (journey.distanceKm === CORRECTED_DISTANCE_KM) {
      results.push({ target, journey, alreadyCorrected: true });
      continue;
    }
    if (Math.abs(journey.distanceKm - target.originalDistanceKm) > 0.02) {
      throw new Error(
        `${target.fromName} -> ${target.toName} is ${journey.distanceKm} km, not the expected ${target.originalDistanceKm} km.`,
      );
    }
    if (journey.distanceCorrection) {
      throw new Error(
        `${target.fromName} -> ${target.toName} has a ${journey.distanceCorrection.status} correction; refusing a conflicting update.`,
      );
    }
    if (journey.claimItem) {
      throw new Error(
        `${target.fromName} -> ${target.toName} is linked to claim ${journey.claimItem.claimId}; refusing to alter a submitted claim.`,
      );
    }
    if (journey.vehicleType !== "BIKE") {
      throw new Error(
        `Expected a BIKE trip for ${target.fromName} -> ${target.toName}; found ${journey.vehicleType}.`,
      );
    }
    results.push({ target, journey, alreadyCorrected: false });
  }

  return { employee, results };
}

async function main() {
  const { employee, results } = await findTargets(prisma);
  const settings = await getSettings();
  const amount = computeLegAmount(CORRECTED_DISTANCE_KM, "BIKE", settings.rates);

  console.table(
    results.map(({ journey, alreadyCorrected }) => ({
      employee: `${employee.name} (${employee.employeeCode})`,
      date: WORK_DATE,
      route: `${journey.fromName} -> ${journey.toName}`,
      previousKm: journey.distanceKm,
      correctedKm: CORRECTED_DISTANCE_KM,
      previousAmount: journey.amount,
      correctedAmount: amount,
      action: alreadyCorrected ? "already corrected" : APPLY ? "update" : "dry run",
    })),
  );
  if (results.every((result) => result.alreadyCorrected)) {
    console.log("Both trips already have the requested 13 km distance.");
    return;
  }
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to save both corrections.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const current = await findTargets(tx);
    for (const { journey, alreadyCorrected } of current.results) {
      if (alreadyCorrected) continue;

      const target = TARGETS.find((item) => item.fromName === journey.fromName && item.toName === journey.toName);
      if (!target) throw new Error("A target trip changed since inspection; no updates were applied.");

      const updatedAt = new Date();
      await tx.journey.update({
        where: { id: journey.id },
        data: {
          distanceKm: CORRECTED_DISTANCE_KM,
          amount,
          source: "MANUAL",
          manualDistance: true,
          manualReason: "Distance corrected to 13 km as requested by administrator.",
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
            employeeId: current.employee.id,
            workDate: WORK_DATE,
            route: `${journey.fromName} -> ${journey.toName}`,
            previousDistanceKm: target.originalDistanceKm,
            correctedDistanceKm: CORRECTED_DISTANCE_KM,
            previousAmount: journey.amount,
            correctedAmount: amount,
          }),
        },
      });
    }
  });

  console.log(`Updated Balram's two ${WORK_DATE} trips to ${CORRECTED_DISTANCE_KM} km.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
