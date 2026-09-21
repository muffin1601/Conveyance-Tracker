/**
 * Apply already-approved distance corrections to their Journey records.
 *
 * Use once after adding the admin-approval persistence behaviour:
 *   npx tsx scripts/backfill-approved-distance-corrections.ts --apply
 *
 * Without --apply this prints the affected records only. It is safe to run
 * again: journeys whose approved distance and marker already match are skipped.
 */
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const corrections = await prisma.distanceCorrection.findMany({
    where: { status: "APPROVED", finalDistanceKm: { not: null } },
    include: {
      journey: {
        select: { id: true, workDate: true, fromName: true, toName: true, distanceKm: true, amount: true, vehicleType: true, distanceUpdated: true },
      },
      employee: { select: { name: true } },
    },
    orderBy: { reviewedAt: "desc" },
  });
  const pending = corrections.filter((c) =>
    !c.journey.distanceUpdated || c.journey.distanceKm !== c.finalDistanceKm,
  );

  console.log(`approved corrections: ${corrections.length}; journeys needing update: ${pending.length}`);
  if (!pending.length) return;

  const settings = await getSettings();
  for (const correction of pending) {
    const journey = correction.journey;
    const finalDistanceKm = correction.finalDistanceKm!;
    const vehicleType = journey.vehicleType as VehicleType;
    // Flat and actual-fare modes must retain their already-recorded amount.
    const amount = ["BIKE", "CAR"].includes(vehicleType)
      ? computeLegAmount(finalDistanceKm, vehicleType, settings.rates)
      : journey.amount;
    console.log(`${journey.workDate} ${correction.employee.name}: ${journey.fromName ?? "Start"} -> ${journey.toName ?? "Destination"} | ${journey.distanceKm} km -> ${finalDistanceKm} km`);

    if (APPLY) {
      await prisma.journey.update({
        where: { id: journey.id },
        data: {
          distanceKm: finalDistanceKm,
          amount,
          distanceUpdated: true,
          distanceUpdatedAt: correction.reviewedAt ?? new Date(),
        },
      });
      await prisma.auditLog.create({
        data: {
          action: "UPDATE",
          entity: "Journey",
          entityId: journey.id,
          meta: JSON.stringify({
            reason: "approved-distance-correction-backfill",
            correctionId: correction.id,
            originalDistanceKm: journey.distanceKm,
            approvedDistanceKm: finalDistanceKm,
          }),
        },
      });
    }
  }
  if (!APPLY) console.log("Dry run only. Re-run with --apply to save.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
