import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { monthKey } from "@/lib/utils";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Combined per-employee-per-day report: conveyance total, miscellaneous total
 * and grand total side by side. Conveyance figures are computed exactly as
 * before (unchanged); miscellaneous is summed separately.
 */
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

  const [journeys, misc] = await Promise.all([
    prisma.journey.findMany({
      where: { workDate: { startsWith: period }, ...scope.where },
      select: { employeeId: true, workDate: true, distanceKm: true, amount: true, billPath: true, employee: { select: { name: true, employeeCode: true } } },
    }),
    prisma.miscellaneousExpense.findMany({
      where: { workDate: { startsWith: period }, ...scope.where },
      select: { employeeId: true, workDate: true, amount: true, billPath: true, employee: { select: { name: true, employeeCode: true } } },
    }),
  ]);

  interface Row { code: string; name: string; date: string; km: number; conv: number; misc: number; bills: number }
  const rows = new Map<string, Row>();
  const key = (e: string, d: string) => `${e}|${d}`;
  for (const j of journeys) {
    const k = key(j.employeeId, j.workDate);
    const r = rows.get(k) ?? { code: j.employee.employeeCode, name: j.employee.name, date: j.workDate, km: 0, conv: 0, misc: 0, bills: 0 };
    r.km += j.distanceKm; r.conv += j.amount; if (j.billPath) r.bills += 1;
    rows.set(k, r);
  }
  for (const m of misc) {
    const k = key(m.employeeId, m.workDate);
    const r = rows.get(k) ?? { code: m.employee.employeeCode, name: m.employee.name, date: m.workDate, km: 0, conv: 0, misc: 0, bills: 0 };
    r.misc += m.amount; if (m.billPath) r.bills += 1;
    rows.set(k, r);
  }

  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
  const header = ["Employee Code", "Employee", "Date", "Distance (km)", "Conveyance (INR)", "Miscellaneous (INR)", "Grand Total (INR)", "Bills Attached"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of sorted) {
    lines.push([r.code, r.name, r.date, r.km.toFixed(2), r.conv.toFixed(2), r.misc.toFixed(2), (r.conv + r.misc).toFixed(2), String(r.bills)].map(csvCell).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watcon-summary-${period}${employeeSuffix(scope.employee)}.csv"`,
    },
  });
}
