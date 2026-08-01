import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getStartingPointSites } from "@/lib/masterData";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { SettingsForm } from "./SettingsForm";
import { StaffManager } from "./StaffManager";
import { LocationManager } from "./LocationManager";
import { PinGate } from "@/components/PinGate";

/** Staff and sites are edited here, so this page must never serve a stale list. */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const unlocked = await isSettingsUnlocked();
  if (!unlocked) {
    return <PinGate title="Settings locked" subtitle="Enter the PIN to manage company details, staff and locations." />;
  }

  const [settings, staff, sites, startingPoints] = await Promise.all([
    getSettings(),
    prisma.employee.findMany({
      where: { deletedAt: null },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true, employeeCode: true, name: true,
        designation: true, department: true, vehicleType: true, status: true,
        defaultOriginSiteId: true,
      },
    }),
    prisma.site.findMany({
      where: { deletedAt: null },
      orderBy: [{ isOffice: "desc" }, { status: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, address: true, city: true, status: true, isOffice: true },
    }),
    getStartingPointSites(),
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
      <StaffManager staff={staff} hints={hints} startingPoints={startingPoints} />
      <LocationManager sites={sites} />
    </div>
  );
}
