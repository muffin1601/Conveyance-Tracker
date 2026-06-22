import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { monthKey } from "@/lib/utils";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? monthKey();

  const journeys = await prisma.journey.findMany({
    where: { workDate: { startsWith: period } },
    include: { employee: true, fromSite: true, toSite: true },
    orderBy: [{ employeeId: "asc" }, { workDate: "asc" }, { sequence: "asc" }],
  });

  const header = [
    "Employee Code", "Employee", "Department", "Date", "Leg",
    "From", "To", "Vehicle", "Distance (km)", "Duration (min)", "Source", "Amount (INR)",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const j of journeys) {
    lines.push(
      [
        j.employee.employeeCode, j.employee.name, j.employee.department, j.workDate,
        j.sequence + 1, j.fromSite.name, j.toSite.name, j.vehicleType,
        j.distanceKm.toFixed(2), j.durationMin ?? "", j.source, j.amount.toFixed(2),
      ].map(csvCell).join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="watcon-conveyance-${period}.csv"`,
    },
  });
}
