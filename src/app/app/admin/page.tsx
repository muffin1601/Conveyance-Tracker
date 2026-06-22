import { prisma } from "@/lib/prisma";
import { monthKey } from "@/lib/utils";
import { StatCard } from "@/components/ui";
import { Download } from "lucide-react";
import { AdminVisits } from "./AdminVisits";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { PinGate } from "@/components/PinGate";

export default async function AdminPage() {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) return <PinGate title="Admin locked" subtitle="Enter the PIN to view all conveyance entries." />;

  const period = monthKey();
  const [empCount, siteCount, journeys] = await Promise.all([
    prisma.employee.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.site.count({ where: { status: "ACTIVE", isOffice: false, deletedAt: null } }),
    prisma.journey.findMany({
      where: { workDate: { startsWith: period } },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        employee: { select: { name: true } },
        toSite: { select: { name: true, city: true } },
      },
    }),
  ]);

  const monthAmount = journeys.reduce((s, j) => s + j.amount, 0);
  const monthKm = journeys.reduce((s, j) => s + j.distanceKm, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Admin</h2>
          <p className="text-sm text-muted">All conveyance entries for {period}.</p>
        </div>
        <a href={`/api/export/conveyance?period=${period}`} className="btn-ghost text-sm">
          <Download className="h-4 w-4" /> Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active Employees" value={empCount} accent />
        <StatCard label="Active Sites" value={siteCount} />
        <StatCard label="Entries This Month" value={journeys.length} />
        <StatCard label="Distance This Month" value={`${monthKm.toFixed(0)} km`} />
      </div>

      <AdminVisits
        visits={journeys.map((j) => ({
          id: j.id,
          employee: j.employee.name,
          site: j.toSite.name + (j.toSite.city ? ` · ${j.toSite.city}` : ""),
          date: j.workDate,
          distanceKm: j.distanceKm,
          amount: j.amount,
          mode: j.vehicleType,
        }))}
        monthAmount={monthAmount}
      />
    </div>
  );
}
