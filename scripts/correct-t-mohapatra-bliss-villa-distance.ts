/** Correct T. Mohapatra's Blissville round-trip distance on 17 and 19 Oct 2026. */
import { PrismaClient } from "@prisma/client";
import { computeLegAmount } from "../src/lib/conveyance";
import { getSettings } from "../src/lib/settings";
import type { VehicleType } from "../src/lib/enums";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const RETURN = process.argv.includes("--return");
const WORK_DATES = ["2026-10-17", "2026-10-19"];
const CONFIRMED_DISTANCE_KM = 54;
const REASON = "Manual distance confirmed by admin: 54 km.";

async function main() {
  const employee = await prisma.employee.findFirstOrThrow({
    where: { name: { contains: "mohapatra", mode: "insensitive" } },
    select: { id: true, name: true, vehicleType: true },
  });
  const [office, blissVilla] = await Promise.all([
    prisma.site.findFirstOrThrow({ where: { isOffice: true, status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.site.findFirstOrThrow({ where: { name: { contains: "blissvi", mode: "insensitive" }, status: "ACTIVE" }, select: { id: true, name: true } }),
  ]);
  const fromSiteId = RETURN ? blissVilla.id : office.id;
  const toSiteId = RETURN ? office.id : blissVilla.id;
  const direction = RETURN ? `${blissVilla.name} -> ${office.name}` : `${office.name} -> ${blissVilla.name}`;
  const legs = await prisma.journey.findMany({
    where: {
      employeeId: employee.id,
      workDate: { in: WORK_DATES },
      fromSiteId,
      toSiteId,
      sequence: RETURN ? 1 : 0,
    },
    orderBy: { workDate: "asc" },
    select: { id: true, workDate: true, distanceKm: true, amount: true, source: true, manualDistance: true },
  });
  if (legs.length !== WORK_DATES.length || !WORK_DATES.every((date) => legs.some((leg) => leg.workDate === date))) {
    throw new Error(`Expected one ${direction} leg on each requested date; found:\n${JSON.stringify(legs, null, 2)}`);
  }
  const amount = computeLegAmount(CONFIRMED_DISTANCE_KM, employee.vehicleType as VehicleType, (await getSettings()).rates);
  console.table(legs.map((leg) => ({
    date: leg.workDate, fromKm: leg.distanceKm, toKm: CONFIRMED_DISTANCE_KM,
    fromAmount: leg.amount, toAmount: amount, source: leg.source,
  })));
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to save the confirmed 54 km distance.");
    return;
  }
  await prisma.$transaction(legs.map((leg) => prisma.journey.update({
    where: { id: leg.id },
    data: {
      distanceKm: CONFIRMED_DISTANCE_KM,
      amount,
      source: "MANUAL",
      manualDistance: true,
      manualReason: REASON,
      roadKm: null,
      durationMin: null,
      distanceUpdated: true,
      distanceUpdatedAt: new Date(),
    },
  })));
  console.log(`Updated ${legs.length} ${direction} legs to ${CONFIRMED_DISTANCE_KM} km.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
