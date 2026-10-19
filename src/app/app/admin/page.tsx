import { prisma } from "@/lib/prisma";
import { monthKey, inr, loginTimestamp } from "@/lib/utils";
import { StatCard } from "@/components/ui";
import { Download } from "lucide-react";
import { AdminVisits } from "./AdminVisits";
import { AdminMisc } from "./AdminMisc";
import { LocationApprovals } from "./LocationApprovals";
import { PeriodPicker } from "./PeriodPicker";
import { EmployeeFilter } from "./EmployeeFilter";
import { getActiveEmployees } from "@/lib/masterData";
import { legToAddress, legToName } from "@/lib/journeyEndpoint";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { PinGate } from "@/components/PinGate";
import { DistanceCorrections } from "./DistanceCorrections";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { TablePagination } from "./TablePagination";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; employee?: string; tab?: string; page?: string; size?: string }>;
}) {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) return <PinGate title="Admin locked" subtitle="Enter the PIN to view all conveyance entries." />;

  // Period is selectable (?period=YYYY-MM). Defaults to the current month, but
  // any earlier month can be viewed — previously the view was hard-locked to
  // the current month, hiding all entries from prior months.
  const sp = await searchParams;
  const validTabs = ["overview", "entries", "expenses", "corrections", "locations", "exports"] as const;
  const tab = validTabs.includes(sp.tab as typeof validTabs[number]) ? sp.tab as typeof validTabs[number] : "overview";
  const parsedSize = Number(sp.size);
  const size = [10, 25, 50, 100].includes(parsedSize) ? parsedSize : 10;
  const requestedPage = Math.max(1, Number(sp.page) || 1);
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : monthKey();

  // Optional per-employee scope. Validated against the live roster so a stale
  // or hand-edited ?employee= can never silently show an empty report.
  const employees = await getActiveEmployees();
  const employeeId = sp.employee && employees.some((e) => e.id === sp.employee) ? sp.employee : "";
  const employeeName = employees.find((e) => e.id === employeeId)?.name ?? "";

  // One filter object drives the table, the aggregates and the exports, so a
  // scoped view can never show one person's rows with everybody's totals.
  const periodFilter = {
    workDate: { startsWith: period },
    ...(employeeId ? { employeeId } : {}),
  };
  /** Query string shared by every export link, so downloads match the view. */
  const exportQuery = `period=${period}${employeeId ? `&employee=${employeeId}` : ""}`;

  const [empCount, siteCount, journeys, journeyStats, miscExpenses, miscStats, customLocations, corrections] =
    await Promise.all([
      prisma.employee.count({ where: { status: "ACTIVE", deletedAt: null } }),
      prisma.site.count({ where: { status: "ACTIVE", isOffice: false, deletedAt: null } }),
      prisma.journey.findMany({
        where: periodFilter,
        orderBy: { createdAt: "desc" },
        skip: (requestedPage - 1) * size,
        take: size,
        include: {
          employee: { select: { name: true } },
          toSite: { select: { name: true, city: true, address: true } },
          toCustomLocation: { select: { locationName: true, address: true } },
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
        skip: (requestedPage - 1) * size,
        take: size,
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
      prisma.distanceCorrection.findMany({ where: { status: { in: ["PENDING", "MANUAL_REVIEW", "AUTO_VERIFIED"] } }, orderBy: { submittedAt: "desc" }, include: { employee: { select: { name: true } }, journey: { select: { workDate: true, fromName: true, toName: true } } } }),
    ]);

  const convAmount = journeyStats._sum.amount ?? 0;
  const monthKm = journeyStats._sum.distanceKm ?? 0;
  const miscAmount = miscStats._sum.amount ?? 0;
  const journeyTotalCount = journeyStats._count;
  const miscTotalCount = miscStats._count;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-surface p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Admin workspace</h2>
          <p className="mt-1 text-sm text-muted">
            {employeeName ? `${employeeName} — ${period}` : `All activity for ${period}`}
          </p>
          <p className="mt-2 text-xs text-muted">Review entries, resolve corrections, and export the same filtered data shown below.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <EmployeeFilter employees={employees} employeeId={employeeId} period={period} />
          <PeriodPicker period={period} />
        </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted">Download</span>
          <a href={`/api/export/summary?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Summary</a>
          <a href={`/api/export/conveyance?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Conveyance</a>
          <a href={`/api/export/misc?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Miscellaneous</a>
        </div>
      </div>

      <WorkspaceTabs
        value={tab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "entries", label: "Conveyance", count: journeyTotalCount },
          { id: "expenses", label: "Expenses", count: miscTotalCount },
          { id: "corrections", label: "Corrections", count: corrections.length },
          { id: "locations", label: "Custom locations", count: customLocations.length },
          { id: "exports", label: "Reports & exports" },
        ]}
      />

      {(tab === "overview" || tab === "entries" || tab === "expenses") && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Conveyance Total" value={inr(convAmount)} sub={`${monthKm.toFixed(0)} km · ${journeyTotalCount} entries`} accent />
        <StatCard label="Miscellaneous Total" value={inr(miscAmount)} sub={`${miscTotalCount} entries`} />
        <StatCard label="Grand Total" value={inr(convAmount + miscAmount)} accent />
        <StatCard label={employeeName ? "Showing" : "Active Employees / Sites"} value={employeeName || `${empCount} / ${siteCount}`} sub={employeeName ? "filtered to one employee" : undefined} />
      </div>}

      {tab === "entries" && <><AdminVisits
        visits={journeys.map((j) => ({
          id: j.id,
          employee: j.employee.name,
          site: legToName(j) + (j.toSite?.city ? ` · ${j.toSite.city}` : ""),
          address: legToAddress(j),
          date: j.workDate,
          // Serialised so the client component gets a plain string; loginAt is
          // the real login time where one was recorded, createdAt the honest
          // fallback for legs that pre-date it (see lib/utils#loginTimestamp).
          loginAt: loginTimestamp(j)?.toISOString() ?? null,
          distanceKm: j.distanceKm,
          distanceUpdated: j.distanceUpdated,
          amount: j.amount,
          mode: j.vehicleType,
          distanceSource: j.source,
          locationType: j.locationType,
          billPath: j.billPath,
          billName: j.billName,
          billType: j.billType,
        }))}
        monthAmount={convAmount}
        shownOf={{ shown: journeys.length, total: journeyTotalCount }}
      /><TablePagination total={journeyTotalCount} page={requestedPage} size={size} /></>}

      {tab === "expenses" && <><AdminMisc
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
      /><TablePagination total={miscTotalCount} page={requestedPage} size={size} /></>}
      {tab === "corrections" && <DistanceCorrections rows={corrections.map(c => ({ id: c.id, employee: c.employee.name, date: c.journey.workDate, from: c.journey.fromName ?? "Start", to: c.journey.toName ?? "Destination", original: c.originalDistanceKm, submitted: c.submittedDistanceKm, status: c.status }))} />}

      {tab === "locations" && <LocationApprovals
        locations={customLocations.map((l) => ({
          id: l.id,
          locationName: l.locationName,
          address: l.address,
          city: l.city,
          state: l.state,
          source: l.source,
          isGlobal: l.isGlobal,
          employee: l.employee.name,
          loginAt: loginTimestamp(l)?.toISOString() ?? null,
        }))}
      />}

      {tab === "exports" && <section className="card p-4">
        <h3 className="font-semibold">Reports & exports</h3>
        <p className="mt-1 text-sm text-muted">Downloads use the selected month and employee filter above.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`/api/export/summary?${exportQuery}`} className="btn-primary text-sm"><Download className="h-4 w-4" /> Monthly summary</a>
          <a href={`/api/export/conveyance?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Conveyance CSV</a>
          <a href={`/api/export/misc?${exportQuery}`} className="btn-ghost text-sm"><Download className="h-4 w-4" /> Expenses CSV</a>
        </div>
      </section>}
    </div>
  );
}
