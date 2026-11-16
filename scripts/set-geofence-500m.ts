/** Raise the company and all smaller site GPS radii to 500 m. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const OLD_RADIUS = 200;
const NEW_RADIUS = 500;

async function main() {
  const [setting, sitesToRaise, newSites, largerSites] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "company" } }),
    prisma.site.count({ where: { geofenceRadius: { lt: NEW_RADIUS }, deletedAt: null } }),
    prisma.site.count({ where: { geofenceRadius: NEW_RADIUS, deletedAt: null } }),
    prisma.site.count({ where: { geofenceRadius: { gt: NEW_RADIUS }, deletedAt: null } }),
  ]);
  if (!setting) throw new Error("Company settings are missing.");
  const settings = JSON.parse(setting.value) as Record<string, unknown>;
  const current = settings.geofenceRadius;
  if (current !== OLD_RADIUS && current !== NEW_RADIUS) {
    throw new Error(`Company radius is ${String(current)} m, not the expected ${OLD_RADIUS} or ${NEW_RADIUS} m.`);
  }
  console.table([{ companyRadiusM: current, newRadiusM: NEW_RADIUS,
    sitesToRaise, sitesAlready500m: newSites, largerSiteRadiiPreserved: largerSites,
    action: current === NEW_RADIUS && sitesToRaise === 0 ? "already updated" : APPLY ? "update" : "dry run" }]);
  const radii = await prisma.site.groupBy({ by: ["geofenceRadius"],
    where: { deletedAt: null, status: "ACTIVE" }, _count: { _all: true },
    orderBy: { geofenceRadius: "asc" } });
  console.table(radii.map((row) => ({ radiusM: row.geofenceRadius, activeSites: row._count._all })));
  if (!APPLY || (current === NEW_RADIUS && sitesToRaise === 0)) return;

  await prisma.$transaction(async (tx) => {
    const latest = await tx.setting.findUnique({ where: { key: "company" } });
    if (!latest || latest.value !== setting.value) throw new Error("Company settings changed during inspection.");
    const updatedSites = await tx.site.updateMany({
      where: { geofenceRadius: { lt: NEW_RADIUS }, deletedAt: null },
      data: { geofenceRadius: NEW_RADIUS },
    });
    if (updatedSites.count !== sitesToRaise) throw new Error("Site radii changed during inspection.");
    await tx.setting.update({ where: { key: "company" },
      data: { value: JSON.stringify({ ...settings, geofenceRadius: NEW_RADIUS }) } });
    await tx.$executeRaw`ALTER TABLE "Site" ALTER COLUMN "geofenceRadius" SET DEFAULT 500`;
    await tx.auditLog.create({ data: { action: "UPDATE", entity: "Setting", entityId: "company",
      meta: JSON.stringify({ source: "admin-geofence-script",
        previousRadiusM: current, newRadiusM: NEW_RADIUS,
        updatedSiteCount: updatedSites.count, largerSiteRadiiPreserved: largerSites }) } });
  });
  console.log(`Set company GPS radius to ${NEW_RADIUS} m and updated ${sitesToRaise} site radii.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
