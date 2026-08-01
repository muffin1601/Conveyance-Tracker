import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { monthKey } from "@/lib/utils";
import { legFromName, legToName } from "@/lib/journeyEndpoint";
import { LOCATION_TYPE_LABEL, LOCATION_TYPES, type LocationType } from "@/lib/enums";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  // These endpoints stream every employee's travel and expense data for a whole
  // month. The Admin page that links to them is PIN-gated, but the URLs
  // themselves were reachable by anyone who knew the path. Same gate, same key.
  if (!(await isSettingsUnlocked())) {
    return NextResponse.json({ error: "Admin is locked." }, { status: 401 });
  }

  const period = req.nextUrl.searchParams.get("period") ?? monthKey();
  const typeParam = req.nextUrl.searchParams.get("type"); // MASTER | GPS | CUSTOM | null
  const type = LOCATION_TYPES.includes(typeParam as LocationType) ? (typeParam as LocationType) : null;

  const journeys = await prisma.journey.findMany({
    where: { workDate: { startsWith: period }, ...(type ? { locationType: type } : {}) },
    include: {
      employee: true,
      fromSite: true,
      toSite: true,
      fromCustomLocation: { select: { locationName: true } },
      toCustomLocation: { select: { locationName: true } },
    },
    orderBy: [{ employeeId: "asc" }, { workDate: "asc" }, { sequence: "asc" }],
  });

  const header = [
    "Employee Code", "Employee", "Department", "Date", "Leg",
    "From", "To", "Location Type", "Vehicle", "Distance (km)", "Duration (min)", "Source", "Amount (INR)",
    "Bill Available", "Bill File",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const j of journeys) {
    lines.push(
      [
        j.employee.employeeCode, j.employee.name, j.employee.department, j.workDate,
        j.sequence + 1, legFromName(j), legToName(j),
        LOCATION_TYPE_LABEL[j.locationType as LocationType] ?? j.locationType,
        j.vehicleType, j.distanceKm.toFixed(2), j.durationMin ?? "", j.source, j.amount.toFixed(2),
        j.billPath ? "Yes" : "No", j.billName ?? "",
      ].map(csvCell).join(","),
    );
  }

  const suffix = type ? `-${type.toLowerCase()}` : "";
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watcon-conveyance-${period}${suffix}.csv"`,
    },
  });
}
