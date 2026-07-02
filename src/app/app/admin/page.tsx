import { prisma } from "@/lib/prisma";
import { monthKey, inr } from "@/lib/utils";
import { StatCard } from "@/components/ui";
import { Download } from "lucide-react";
import { AdminVisits } from "./AdminVisits";
import { AdminMisc } from "./AdminMisc";
import { LocationApprovals } from "./LocationApprovals";
import { PeriodPicker } from "./PeriodPicker";
import { legToName } from "@/lib/journeyEndpoint";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { PinGate } from "@/components/PinGate";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) return <PinGate title="Admin locked" subtitle="Enter the PIN to view all conveyance entries." />;

  // Period is selectable (?period=YYYY-MM). Defaults to the current month, but
  // any earlier month can be viewed — previously the view was hard-locked to
  // the current month, hiding all entries from prior months.
  const raw = (await searchParams).period;
  const period = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : monthKey();

  const [empCount, siteCount, journeys, miscExpenses, customLocations] = await Promise.all([
    prisma.employee.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.site.count({ where: { status: "ACTIVE", isOffice: false, deletedAt: null } }),
    prisma.journey.findMany({
      where: { workDate: { startsWith: period } },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        employee: { select: { name: true } },
        toSite: { select: { name: true, city: true } },
        toCustomLocation: { select: { locationName: true } },
      },
    }),
    prisma.miscellaneousExpense.findMany({
      where: { workDate: { startsWith: period } },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { employee: { select: { name: true } } },
    }),
    prisma.userCustomLocation.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ isGlobal: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { employee: { select: { name: true } } },
    }),
  ]);

  const convAmount = journeys.reduce((s, j) => s + j.amount, 0);
  const monthKm = journeys.reduce((s, j) => s + j.distanceKm, 0);
  const miscAmount = miscExpenses.reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Admin</h2>
          <p className="text-sm text-muted">All activity for {period}.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodPicker period={period} />
          <a href={`/api/export/summary?period=${period}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Summary</a>
          <a href={`/api/export/conveyance?period=${period}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Conveyance</a>
          <a href={`/api/export/misc?period=${period}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Miscellaneous</a>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Conveyance Total" value={inr(convAmount)} sub={`${monthKm.toFixed(0)} km · ${journeys.length} entries`} accent />
        <StatCard label="Miscellaneous Total" value={inr(miscAmount)} sub={`${miscExpenses.length} entries`} />
        <StatCard label="Grand Total" value={inr(convAmount + miscAmount)} accent />
        <StatCard label="Active Employees / Sites" value={`${empCount} / ${siteCount}`} />
      </div>

      <AdminVisits
        visits={journeys.map((j) => ({
          id: j.id,
          employee: j.employee.name,
          site: legToName(j) + (j.toSite?.city ? ` · ${j.toSite.city}` : ""),
          date: j.workDate,
          distanceKm: j.distanceKm,
          amount: j.amount,
          mode: j.vehicleType,
          locationType: j.locationType,
          billPath: j.billPath,
          billName: j.billName,
          billType: j.billType,
        }))}
        monthAmount={convAmount}
      />

      <AdminMisc
        key={period}
        items={miscExpenses.map((m) => ({
          id: m.id,
          employee: m.employee.name,
          date: m.workDate,
          category: m.category,
          customCategory: m.customCategory,
          amount: m.amount,
          description: m.description,
          billPath: m.billPath,
          billName: m.billName,
          billType: m.billType,
        }))}
        total={miscAmount}
      />

      <LocationApprovals
        locations={customLocations.map((l) => ({
          id: l.id,
          locationName: l.locationName,
          address: l.address,
          city: l.city,
          state: l.state,
          source: l.source,
          isGlobal: l.isGlobal,
          employee: l.employee.name,
        }))}
      />
    </div>
  );
}
