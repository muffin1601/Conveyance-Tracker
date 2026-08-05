import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSettingsUnlocked } from "@/app/actions/settings";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The site master, as a spreadsheet.
 *
 * Every distance and fare in this system is measured from these coordinates, so
 * a wrong pin is a wrong reimbursement — and there is no way to spot a wrong pin
 * from inside the app. This export exists to be audited: each row carries a
 * ready-made Google Maps link so an admin can open the saved coordinates, see
 * where they actually land, and correct the ones that are off.
 *
 * Columns are ordered for that job: identity first, then the address as written,
 * then the coordinates and the link that verifies them.
 */
export async function GET(req: NextRequest) {
  // Same gate as the other exports — this is the full site master, and the
  // Settings page that links to it is PIN-locked.
  if (!(await isSettingsUnlocked())) {
    return NextResponse.json({ error: "Admin is locked." }, { status: 401 });
  }

  // ?status=active trims the file to what staff can actually pick; the default
  // is everything, because a retired site's coordinates still back past trips.
  const activeOnly = req.nextUrl.searchParams.get("status") === "active";

  const sites = await prisma.site.findMany({
    where: activeOnly ? { status: "ACTIVE" } : {},
    orderBy: [{ isOffice: "desc" }, { code: "asc" }],
  });

  const header = [
    "Code", "Name", "Type", "Status",
    "Address", "Landmark", "City", "State", "Pincode",
    "Latitude", "Longitude", "Geofence Radius (m)",
    "Google Maps Link",
  ];
  const lines = [header.map(csvCell).join(",")];

  for (const s of sites) {
    lines.push([
      s.code,
      s.name,
      s.isOffice ? "Head Office" : s.isStartingPoint ? "Starting Point" : "Site",
      s.status,
      s.address,
      s.landmark ?? "",
      s.city ?? "",
      s.state ?? "",
      s.pincode ?? "",
      // 6 dp ≈ 0.1 m — well past what any reimbursement needs, but it round-trips
      // the stored value exactly so re-importing this file changes nothing.
      s.latitude.toFixed(6),
      s.longitude.toFixed(6),
      s.geofenceRadius,
      `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}`,
    ].map(csvCell).join(","));
  }

  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(
    // Addresses come back from the geocoder with non-ASCII characters in them.
    // Excel assumes the system codepage unless a BOM says otherwise, which turns
    // those into mojibake — and this file is meant to be opened in Excel.
    "﻿" + lines.join("\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="watcon-locations-${today}.csv"`,
      },
    },
  );
}
