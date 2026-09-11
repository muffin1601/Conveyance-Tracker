/** Sync September 2026 per-km reimbursements after the Showroom pin correction. */
import { prisma } from "../src/lib/prisma";

const SHOWROOM_ID = "cmsacxtym0000bvt09odhzwr7";
const MONTH = "2026-09";
const RATES = { BIKE: 4, CAR: 11 } as const;

async function main() {
  const journeys = await prisma.journey.findMany({
    where: {
      workDate: { startsWith: MONTH },
      vehicleType: { in: ["BIKE", "CAR"] },
      OR: [{ fromSiteId: SHOWROOM_ID }, { toSiteId: SHOWROOM_ID }],
    },
    select: {
      id: true, vehicleType: true, distanceKm: true,
    },
  });

  let updated = 0;
  for (const journey of journeys) {
    const rate = RATES[journey.vehicleType as keyof typeof RATES];
    const correctedAmount = Math.round(rate * journey.distanceKm * 100) / 100;
    await prisma.journey.update({ where: { id: journey.id }, data: { amount: correctedAmount } });
    updated++;
  }
  console.log(JSON.stringify({ month: MONTH, rates: RATES, updated }, null, 2));
}

const keepAlive = setInterval(() => {}, 1_000);
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  clearInterval(keepAlive);
  await prisma.$disconnect();
});
