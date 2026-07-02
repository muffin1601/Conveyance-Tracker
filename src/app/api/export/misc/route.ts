import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/lib/utils";
import { MISC_CATEGORY_LABEL, type MiscCategory } from "@/lib/enums";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? monthKey();

  const items = await prisma.miscellaneousExpense.findMany({
    where: { workDate: { startsWith: period } },
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
      "Content-Disposition": `attachment; filename="watcon-misc-${period}.csv"`,
    },
  });
}
