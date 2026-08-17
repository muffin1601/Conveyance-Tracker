import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { fmtDate, fmtTime, loginTimestamp, monthKey } from "@/lib/utils";
import { legFromAddress, legFromName, legToAddress, legToName } from "@/lib/journeyEndpoint";
import { distanceSourceLabel } from "@/lib/routing/types";
import { LOCATION_TYPE_LABEL, LOCATION_TYPES, type LocationType } from "@/lib/enums";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Optional per-employee scope (?employee=<id>), so an admin can download one
 * person's report instead of the whole company's. Validated against the
 * database — an unknown id is rejected rather than silently returning
 * everybody, which would be the dangerous default for a payroll export.
 */
async function employeeScope(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("employee");
  if (!id) return { where: {}, employee: null };
  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { id: true, name: true, employeeCode: true },
  });
  if (!employee) return { where: null, employee: null };
  return { where: { employeeId: employee.id }, employee };
}

/** Filename-safe slug for the chosen employee, e.g. "-WAT-0007-bharat-dash". */
function employeeSuffix(e: { name: string; employeeCode: string } | null) {
  if (!e) return "";
  const slug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `-${e.employeeCode}-${slug}`;
}

export async function GET(req: NextRequest) {
  // These endpoints stream every employee's travel and expense data for a whole
  // month. The Admin page that links to them is PIN-gated, but the URLs
  // themselves were reachable by anyone who knew the path. Same gate, same key.
  if (!(await isSettingsUnlocked())) {
    return NextResponse.json({ error: "Admin is locked." }, { status: 401 });
  }

  const scope = await employeeScope(req);
  if (scope.where === null) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const period = req.nextUrl.searchParams.get("period") ?? monthKey();
  const typeParam = req.nextUrl.searchParams.get("type"); // MASTER | GPS | CUSTOM | null
  const type = LOCATION_TYPES.includes(typeParam as LocationType) ? (typeParam as LocationType) : null;

  const journeys = await prisma.journey.findMany({
    where: { workDate: { startsWith: period }, ...(type ? { locationType: type } : {}), ...scope.where },
    include: {
      employee: true,
      fromSite: true,
      toSite: true,
      fromCustomLocation: { select: { locationName: true, address: true } },
      toCustomLocation: { select: { locationName: true, address: true } },
    },
    orderBy: [{ employeeId: "asc" }, { workDate: "asc" }, { sequence: "asc" }],
  });

  const header = [
    // Login date and time sit beside the work date: the sheet is read as
    // "who, when, where", and a date alone cannot separate a morning trip from
    // an evening one. Same IST formatting as the on-screen report.
    "Employee Code", "Employee", "Department", "Date", "Login Date", "Login Time", "Leg",
    // The two address columns sit next to the names they belong to, so a
    // reviewer reading the sheet left to right gets "where" before "how far".
    "From", "From Address", "To", "To Address", "Location Type", "Vehicle", "Distance (km)", "Distance Type", "Duration (min)", "Source", "Amount (INR)",
    "Bill Available", "Bill File",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const j of journeys) {
    lines.push(
      [
        j.employee.employeeCode, j.employee.name, j.employee.department, j.workDate,
        fmtDate(loginTimestamp(j)), fmtTime(loginTimestamp(j)),
        j.sequence + 1,
        legFromName(j), legFromAddress(j) ?? "",
        legToName(j), legToAddress(j) ?? "",
        LOCATION_TYPE_LABEL[j.locationType as LocationType] ?? j.locationType,
        j.vehicleType, j.distanceKm.toFixed(2), distanceSourceLabel(j.source),
        j.durationMin ?? "", j.source, j.amount.toFixed(2),
        j.billPath ? "Yes" : "No", j.billName ?? "",
      ].map(csvCell).join(","),
    );
  }

  const suffix = `${employeeSuffix(scope.employee)}${type ? `-${type.toLowerCase()}` : ""}`;
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watcon-conveyance-${period}${suffix}.csv"`,
    },
  });
}
