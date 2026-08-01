import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSettingsUnlocked } from "@/app/actions/settings";
import { monthKey } from "@/lib/utils";
import { MISC_CATEGORY_LABEL, type MiscCategory } from "@/lib/enums";

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

  const items = await prisma.miscellaneousExpense.findMany({
    where: { workDate: { startsWith: period }, ...scope.where },
    include: { employee: { select: { name: true, employeeCode: true, department: true } } },
    orderBy: [{ employeeId: "asc" }, { workDate: "asc" }, { createdAt: "asc" }],
  });

  const header = ["Employee Code", "Employee", "Department", "Date", "Category", "Description", "Amount (INR)", "Notes", "Bill Available", "Bill File"];
  const lines = [header.map(csvCell).join(",")];
  for (const e of items) {
    const cat = e.category === "OTHER" ? (e.customCategory || "Other") : MISC_CATEGORY_LABEL[e.category as MiscCategory] ?? e.category;
    lines.push([
      e.employee.employeeCode, e.employee.name, e.employee.department, e.workDate,
      cat, e.description ?? "", e.amount.toFixed(2), e.notes ?? "",
      e.billPath ? "Yes" : "No", e.billName ?? "",
    ].map(csvCell).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watcon-misc-${period}${employeeSuffix(scope.employee)}.csv"`,
    },
  });
}
