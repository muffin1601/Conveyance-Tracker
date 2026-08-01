import { prisma } from "@/lib/prisma";
import { monthKey, inr } from "@/lib/utils";
import { StatCard } from "@/components/ui";
import { Download } from "lucide-react";
import { AdminVisits } from "./AdminVisits";
import { AdminMisc } from "./AdminMisc";
import { LocationApprovals } from "./LocationApprovals";
import { PeriodPicker } from "./PeriodPicker";
import { EmployeeFilter } from "./EmployeeFilter";
import { getActiveEmployees } from "@/lib/masterData";
import { legToName } from "@/lib/journeyEndpoint";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { PinGate } from "@/components/PinGate";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; employee?: string }>;
}) {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) return <PinGate title="Admin locked" subtitle="Enter the PIN to view all conveyance entries." />;

  // Period is selectable (?period=YYYY-MM). Defaults to the current month, but
  // any earlier month can be viewed — previously the view was hard-locked to
  // the current month, hiding all entries from prior months.
  const sp = await searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : monthKey();

  // Optional per-employee scope. Validated against the live roster so a stale
  // or hand-edited ?employee= can never silently show an empty report.
  const employees = await getActiveEmployees();
  const employeeId = sp.employee && employees.some((e) => e.id === sp.employee) ? sp.employee : "";
  const employeeName = employees.find((e) => e.id === employeeId)?.name ?? "";

  const PAGE_SIZE = 300;
  // One filter object drives the table, the aggregates and the exports, so a
  // scoped view can never show one person's rows with everybody's totals.
  const periodFilter = {
    workDate: { startsWith: period },
    ...(employeeId ? { employeeId } : {}),
  };
  /** Query string shared by every export link, so downloads match the view. */
  const exportQuery = `period=${period}${employeeId ? `&employee=${employeeId}` : ""}`;

  const [empCount, siteCount, journeys, journeyStats, miscExpenses, miscStats, customLocations] =
    await Promise.all([
      prisma.employee.count({ where: { status: "ACTIVE", deletedAt: null } }),
      prisma.site.count({ where: { status: "ACTIVE", isOffice: false, deletedAt: null } }),
      prisma.journey.findMany({
        where: periodFilter,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        include: {
          employee: { select: { name: true } },
          toSite: { select: { name: true, city: true } },
          toCustomLocation: { select: { locationName: true } },
        },
      }),
      // Totals are aggregated in the database over the WHOLE period. Summing
      // the capped 300-row page understated every figure once a month passed
      // 300 entries — the headline numbers were silently wrong.
      prisma.journey.aggregate({
        where: periodFilter,
        _sum: { amount: true, distanceKm: true },
        _count: true,
      }),
      prisma.miscellaneousExpense.findMany({
        where: periodFilter,
        orderBy: { createdAt: "desc" },
        take: PAGE_SIZE,
        include: { employee: { select: { name: true } } },
      }),
      prisma.miscellaneousExpense.aggregate({
        where: periodFilter,
        _sum: { amount: true },
        _count: true,
      }),
      prisma.userCustomLocation.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ isGlobal: "asc" }, { createdAt: "desc" }],
        take: 200,
        include: { employee: { select: { name: true } } },
      }),
    ]);

  const convAmount = journeyStats._sum.amount ?? 0;
  const monthKm = journeyStats._sum.distanceKm ?? 0;
  const miscAmount = miscStats._sum.amount ?? 0;
  const journeyTotalCount = journeyStats._count;
  const miscTotalCount = miscStats._count;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Admin</h2>
          <p className="text-sm text-muted">
            {employeeName ? `${employeeName} — ${period}` : `All activity for ${period}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <EmployeeFilter employees={employees} employeeId={employeeId} period={period} />
          <PeriodPicker period={period} />
          <a href={`/api/export/summary?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Summary</a>
          <a href={`/api/export/conveyance?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Conveyance</a>
          <a href={`/api/export/misc?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Miscellaneous</a>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Conveyance Total" value={inr(convAmount)} sub={`${monthKm.toFixed(0)} km · ${journeyTotalCount} entries`} accent />
        <StatCard label="Miscellaneous Total" value={inr(miscAmount)} sub={`${miscTotalCount} entries`} />
        <StatCard label="Grand Total" value={inr(convAmount + miscAmount)} accent />
        <StatCard label={employeeName ? "Showing" : "Active Employees / Sites"} value={employeeName || `${empCount} / ${siteCount}`} sub={employeeName ? "filtered to one employee" : undefined} />
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
        shownOf={{ shown: journeys.length, total: journeyTotalCount }}
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
