/**
 * Re-measure legs whose distance is not a real road route.
 *
 * A leg is stored with the distance that was available at the time. If every
 * routing provider was unreachable (source HAVERSINE) the figure is a
 * straight-line estimate, and reimbursement was calculated from it. This
 * upgrades those legs once routing is reachable again.
 *
 *   npx tsx scripts/backfill-road-distance.ts                 # dry run
 *   npx tsx scripts/backfill-road-distance.ts --apply         # write
 *   npx tsx scripts/backfill-road-distance.ts --include-manual --apply
 *
 * Safety rules, in order of importance:
 *  - A leg already routed (OSRM / CACHE / GOOGLE) is NEVER re-measured. Its
 *    number was correct on the day and re-running it would silently move
 *    approved reimbursement figures around.
 *  - MANUAL legs are excluded unless --include-manual is passed, because a
 *    typed distance is a business decision, not a measurement error. Even then
 *    the run is dry by default so somebody sees the money change first.
 *  - Amounts are recomputed with the same engine the app uses, so distance and
 *    amount can never drift apart.
 *  - Resumable: it only ever selects legs that still need work, so stopping it
 *    half way and running it again picks up exactly where it left off.
 */
import { PrismaClient } from "@prisma/client";
import { calculateRoadDistance, isRoadDistance } from "../src/lib/routing";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const INCLUDE_MANUAL = process.argv.includes("--include-manual");

/** Small batches keep memory flat and make a stopped run cheap to resume. */
const BATCH = 25;
/** The public OSRM server is shared infrastructure — stay polite. */
const THROTTLE_MS = 300;

async function main() {
  const sources = INCLUDE_MANUAL ? ["HAVERSINE", "MANUAL"] : ["HAVERSINE"];
  const legs = await prisma.journey.findMany({
    where: {
      source: { in: sources },
      fromLat: { not: null }, fromLng: { not: null },
      toLat: { not: null }, toLng: { not: null },
    },
    orderBy: [{ workDate: "asc" }, { sequence: "asc" }],
    select: {
      id: true, workDate: true, sequence: true, source: true,
      distanceKm: true, amount: true, vehicleType: true,
      fromName: true, toName: true, fromLat: true, fromLng: true, toLat: true, toLng: true,
      employee: { select: { name: true } },
    },
  });

  console.log(`legs eligible for re-measurement: ${legs.length}${INCLUDE_MANUAL ? " (including MANUAL)" : ""}`);
  if (!legs.length) {
    console.log("Nothing to do — every leg with coordinates already has a routed distance.");
    return;
  }

  const settings = await getSettings();
  let kmDelta = 0, amountDelta = 0, updated = 0, unroutable = 0;

  for (let i = 0; i < legs.length; i += BATCH) {
    for (const leg of legs.slice(i, i + BATCH)) {
      const route = await calculateRoadDistance({
        origin: { latitude: leg.fromLat!, longitude: leg.fromLng! },
        destination: { latitude: leg.toLat!, longitude: leg.toLng! },
      });
      // Still no route: leave the leg exactly as it is rather than replacing
      // one estimate with another.
      if (!isRoadDistance(route.source) || !route.routeAvailable) {
        unroutable++;
        continue;
      }

      const amount = computeLegAmount(route.distanceKm, leg.vehicleType as VehicleType, settings.rates);
      kmDelta += route.distanceKm - leg.distanceKm;
      amountDelta += amount - leg.amount;
      console.log(
        `  ${leg.workDate} ${leg.employee.name}: ${leg.fromName} -> ${leg.toName}\n` +
        `      ${leg.distanceKm} km (${leg.source}) -> ${route.distanceKm} km (${route.source})   ` +
        `₹${leg.amount} -> ₹${amount}`,
      );

      if (APPLY) {
        await prisma.journey.update({
          where: { id: leg.id },
          data: {
            distanceKm: route.distanceKm,
            roadKm: route.distanceKm,
            durationMin: Math.round(route.durationSeconds / 60),
            source: route.source,
            manualDistance: false,
            amount,
          },
        });
      }
      updated++;
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }

  console.log(
    `\n${APPLY ? "updated" : "would update"}: ${updated} legs` +
    `   still unroutable: ${unroutable}` +
    `\ndistance change: ${kmDelta >= 0 ? "+" : ""}${kmDelta.toFixed(2)} km` +
    `   reimbursement change: ${amountDelta >= 0 ? "+" : ""}₹${amountDelta.toFixed(2)}`,
  );
  if (!APPLY) console.log("\nDry run — nothing written. Re-run with --apply to save.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
