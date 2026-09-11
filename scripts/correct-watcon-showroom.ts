/**
 * Correct the Watcon Showroom pin and re-route every non-manual journey that
 * starts or ends there. Historical GPS check-ins are deliberately untouched:
 * they record where the employee's device was at that time, not the site pin.
 *
 * Run with: npx tsx -r dotenv/config scripts/correct-watcon-showroom.ts
 */
import { prisma } from "../src/lib/prisma";
import { calculateRoadDistance } from "../src/lib/routing";
import { haversineMeters } from "../src/lib/gps";

const SHOWROOM_NAME = "Watcon Showroom";
/** Amounts are being corrected only for the current accounting month. */
const AMOUNT_CORRECTION_MONTH = "2026-09";
const previousShowroom = { lat: 28.49847412109375, lng: 77.16339111328125 };
const showroom = { lat: 28.541270961550648, lng: 77.27325607004377 };

async function main() {
  const site = await prisma.site.findFirst({
    where: { name: { equals: SHOWROOM_NAME, mode: "insensitive" } },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (!site) throw new Error(`${SHOWROOM_NAME} was not found.`);

  const journeys = await prisma.journey.findMany({
    where: {
      manualDistance: false,
      OR: [{ fromSiteId: site.id }, { toSiteId: site.id }],
    },
    select: {
      id: true, workDate: true, fromSiteId: true, toSiteId: true, vehicleType: true, amount: true,
      fromLat: true, fromLng: true, toLat: true, toLng: true,
    },
  });

  await prisma.site.update({
    where: { id: site.id },
    data: { latitude: showroom.lat, longitude: showroom.lng },
  });

  let updated = 0;
  let amountsUpdated = 0;
  const failures: string[] = [];
  for (const journey of journeys) {
    const from = journey.fromSiteId === site.id
      ? showroom
      : { lat: journey.fromLat, lng: journey.fromLng };
    const to = journey.toSiteId === site.id
      ? showroom
      : { lat: journey.toLat, lng: journey.toLng };

    if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) {
      failures.push(`${journey.id}: missing endpoint coordinates`);
      continue;
    }

    const route = await calculateRoadDistance({
      origin: { latitude: from.lat!, longitude: from.lng! },
      destination: { latitude: to.lat!, longitude: to.lng! },
    });
    if (!route.routeAvailable) {
      failures.push(`${journey.id}: routing provider unavailable`);
      continue;
    }

    // Rates are not snapshotted on historical legs. For per-km modes, derive
    // the rate from the original route and amount, then apply that exact rate
    // to the corrected distance. Bus/Metro may contain an actual fare, so its
    // amount is intentionally preserved.
    let amount: number | undefined;
    if (
      journey.workDate.startsWith(AMOUNT_CORRECTION_MONTH) &&
      (journey.vehicleType === "BIKE" || journey.vehicleType === "CAR")
    ) {
      const oldFrom = journey.fromSiteId === site.id
        ? previousShowroom
        : { lat: journey.fromLat, lng: journey.fromLng };
      const oldTo = journey.toSiteId === site.id
        ? previousShowroom
        : { lat: journey.toLat, lng: journey.toLng };
      const oldRoute = await calculateRoadDistance({
        origin: { latitude: oldFrom.lat!, longitude: oldFrom.lng! },
        destination: { latitude: oldTo.lat!, longitude: oldTo.lng! },
      });
      if (oldRoute.routeAvailable && oldRoute.distanceKm > 0) {
        amount = Math.round((journey.amount / oldRoute.distanceKm) * route.distanceKm * 100) / 100;
        amountsUpdated++;
      }
    }

    await prisma.journey.update({
      where: { id: journey.id },
      data: {
        ...(journey.fromSiteId === site.id ? { fromLat: showroom.lat, fromLng: showroom.lng } : {}),
        ...(journey.toSiteId === site.id ? { toLat: showroom.lat, toLng: showroom.lng } : {}),
        distanceKm: route.distanceKm,
        roadKm: route.distanceKm,
        haversineKm: Math.round(haversineMeters(
          { lat: from.lat!, lng: from.lng! }, { lat: to.lat!, lng: to.lng! },
        ) / 10) / 100,
        durationMin: Math.round(route.durationSeconds / 60),
        source: route.source,
        ...(amount === undefined ? {} : { amount }),
      },
    });
    updated++;
  }

  console.log(JSON.stringify({ site: site.name, previous: [site.latitude, site.longitude], corrected: showroom, updated, amountsUpdated, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

// `fetch` alone does not keep the CommonJS process alive under tsx. Keep the
// one-off process alive until all asynchronous route lookups have settled.
const keepAlive = setInterval(() => {}, 1_000);
void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    clearInterval(keepAlive);
    await prisma.$disconnect();
  });
