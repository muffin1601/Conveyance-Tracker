import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
async function main() {
  const rows = await p.$transaction(async (tx) => {
    const employee = await tx.employee.findFirstOrThrow({ where: { name: { equals: "Sultan", mode: "insensitive" } } });
    const office = await tx.site.findFirstOrThrow({ where: { isOffice: true } });
    const blissville = await tx.site.findFirstOrThrow({ where: { name: "BLISVILLE - WHITELAND" } });
    const dps = await tx.site.findFirstOrThrow({ where: { name: "DHARMPAL SINGHLA - DPS" } });
    const workDate = "2026-09-16";
    const add = (from: typeof office, to: typeof office, sequence: number, distanceKm: number, haversineKm: number, durationMin: number, source: string, createdAt: Date) => tx.journey.create({ data: { employeeId: employee.id, workDate, sequence, fromSiteId: from.id, toSiteId: to.id, fromName: from.name, toName: to.name, fromAddress: from.address, toAddress: to.address, fromLat: from.latitude, fromLng: from.longitude, toLat: to.latitude, toLng: to.longitude, locationType: "MASTER", manualDistance: false, distanceKm, roadKm: distanceKm, haversineKm, durationMin, source, vehicleType: "BIKE", amount: Math.round(distanceKm * 4 * 100) / 100, createdAt } });
    const existing = await tx.journey.findFirst({
      where: { employeeId: employee.id, workDate, fromSiteId: dps.id, toSiteId: office.id },
    });
    if (existing) return [existing];
    const sequence = await tx.journey.count({ where: { employeeId: employee.id, workDate } });
    return [await add(dps, office, sequence, 21.92, 16.24, 32, "OSRM", new Date("2026-09-16T17:00:00+05:30"))];
  });
  console.log(rows.map((r) => `${r.fromName} -> ${r.toName}: ${r.distanceKm} km, Rs ${r.amount}`).join("\n"));
}
main().finally(() => p.$disconnect());
