import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getStartingPointSites } from "@/lib/masterData";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { SettingsForm } from "./SettingsForm";
import { StaffManager } from "./StaffManager";
import { LocationManager } from "./LocationManager";
import { CorrectionHistory } from "./CorrectionHistory";
import { PinGate } from "@/components/PinGate";

/** Staff and sites are edited here, so this page must never serve a stale list. */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) {
    return <PinGate title="Settings locked" subtitle="Enter the PIN to manage company details, staff and locations." />;
  }

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
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted">Company details, conveyance rates, staff and locations.</p>
      </div>

      <SettingsForm settings={settings} />
      <CorrectionHistory
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
      />
      <StaffManager staff={staff} hints={hints} startingPoints={startingPoints} />
      <LocationManager sites={sites} />
    </div>
  );
}
