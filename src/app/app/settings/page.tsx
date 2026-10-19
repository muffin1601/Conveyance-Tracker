import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getStartingPointSites } from "@/lib/masterData";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { SettingsForm } from "./SettingsForm";
import { StaffManager } from "./StaffManager";
import { LocationManager } from "./LocationManager";
import { CorrectionHistory } from "./CorrectionHistory";
import { PinGate } from "@/components/PinGate";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";

/** Staff and sites are edited here, so this page must never serve a stale list. */
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) {
    return <PinGate title="Settings locked" subtitle="Enter the PIN to manage company details, staff and locations." />;
  }
  const sp = await searchParams;
  const validTabs = ["general", "rates", "security", "staff", "locations", "history"] as const;
  const tab = validTabs.includes(sp.tab as typeof validTabs[number]) ? sp.tab as typeof validTabs[number] : "general";

  const [settings, staff, sites, startingPoints, correctionHistory] = await Promise.all([
    getSettings(),
    prisma.employee.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true, employeeCode: true, name: true,
        designation: true, department: true, vehicleType: true, phone: true, status: true,
        defaultOriginSiteId: true,
      },
    }),
    prisma.site.findMany({
      where: { deletedAt: null },
      orderBy: [{ isOffice: "desc" }, { status: "asc" }, { name: "asc" }],
      select: {
        id: true, code: true, name: true, address: true, landmark: true,
        latitude: true, longitude: true, city: true, status: true, isOffice: true,
      },
    }),
    getStartingPointSites(),
    prisma.distanceCorrection.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: [{ reviewedAt: "desc" }, { submittedAt: "desc" }],
      select: {
        id: true,
        originalDistanceKm: true,
        submittedDistanceKm: true,
        finalDistanceKm: true,
        status: true,
        reviewedAt: true,
        adminNote: true,
        screenshotName: true,
        employee: { select: { name: true } },
        journey: { select: { workDate: true, fromName: true, toName: true } },
      },
    }),
  ]);

  // Offer the values already in use as suggestions, so new entries stay
  // consistent with the existing roster instead of drifting into synonyms.
  // The DEFAULT is the most common value, not the alphabetically first — most
  // new joiners match the majority, and "Driver" simply sorting first is a
  // misleading thing to pre-fill.
  const tally = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    const options = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return { options, commonest };
  };
  const desig = tally(staff.map((s) => s.designation));
  const dept = tally(staff.map((s) => s.department));
  const hints = {
    designations: desig.options,
    departments: dept.options,
    defaultDesignation: desig.commonest || "Field Staff",
    defaultDepartment: dept.commonest || "Operations",
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div className="rounded-lg border bg-surface p-5">
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-1 text-sm text-muted">Manage company defaults, reimbursement rates, people, and approved locations.</p>
        <div className="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
          <p className="rounded-md bg-bg px-3 py-2"><span className="font-medium text-fg">1.</span> Update company details and rates</p>
          <p className="rounded-md bg-bg px-3 py-2"><span className="font-medium text-fg">2.</span> Keep the staff roster current</p>
          <p className="rounded-md bg-bg px-3 py-2"><span className="font-medium text-fg">3.</span> Check location pins before use</p>
        </div>
      </div>

      <WorkspaceTabs value={tab} tabs={[
        { id: "general", label: "General" },
        { id: "rates", label: "Conveyance rates" },
        { id: "security", label: "Security" },
        { id: "staff", label: "Staff", count: staff.length },
        { id: "locations", label: "Locations", count: sites.length },
        { id: "history", label: "Correction history", count: correctionHistory.length },
      ]} />

      {(tab === "general" || tab === "rates" || tab === "security") && <SettingsForm settings={settings} section={tab as "general" | "rates" | "security"} />}
      {tab === "history" && <CorrectionHistory
        rows={correctionHistory.map((correction) => ({
          id: correction.id,
          employee: correction.employee.name,
          date: correction.journey.workDate,
          from: correction.journey.fromName ?? "Start",
          to: correction.journey.toName ?? "Destination",
          original: correction.originalDistanceKm,
          submitted: correction.submittedDistanceKm,
          final: correction.finalDistanceKm,
          status: correction.status as "APPROVED" | "REJECTED",
          reviewedAt: correction.reviewedAt?.toISOString() ?? null,
          adminNote: correction.adminNote,
          screenshotName: correction.screenshotName,
        }))}
      />}
      {tab === "staff" && <StaffManager staff={staff} hints={hints} startingPoints={startingPoints} />}
      {tab === "locations" && <LocationManager sites={sites} />}
    </div>
  );
}
