/**
 * Seeds the ISOLATED recording database (SQLite) used to shoot the tutorial.
 *
 * This never touches production: it is only ever run with DATABASE_URL pointing
 * at video/build/demo.db. It reuses the real seed data (74 sites, 33 staff) so
 * the video shows genuine master data, then adds a small, believable trip
 * history for the demo employee so the History / Summary screens are not empty.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

interface SeedData {
  office: { name: string; address: string; pincode: string; lat: number; lng: number; city: string; state: string };
  sites: { sno: number; name: string; address: string; pincode: string | null; lat: number; lng: number; city: string; state: string; geofenceRadius: number }[];
  employees: { sno: number; name: string; rawName: string; designation: string; department: string; vehicleType: string }[];
}

const pad = (n: number, w = 4) => String(n).padStart(w, "0");

/** The employee the tutorial is recorded as. Picked from the real roster. */
export const DEMO_EMPLOYEE_NAME = "Bharat Dash";

function guardIsolated() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) {
    throw new Error(
      `Refusing to seed: DATABASE_URL must be a local SQLite file for recording, got "${url.slice(0, 24)}…". ` +
      "This script deletes all rows and must never run against production.",
    );
  }
}

async function main() {
  guardIsolated();

  const data: SeedData = JSON.parse(
    readFileSync(join(process.cwd(), "data", "seed-data.json"), "utf8"),
  );

  console.log("→ Resetting the isolated recording database…");
  await prisma.journeyReset.deleteMany();
  await prisma.journey.deleteMany();
  await prisma.siteVisit.deleteMany();
  await prisma.miscellaneousExpense.deleteMany();
  await prisma.userCustomLocation.deleteMany();
  await prisma.distanceCache.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.site.deleteMany();
  await prisma.user.deleteMany();
  await prisma.setting.deleteMany();

  await prisma.setting.create({
    data: {
      key: "company",
      value: JSON.stringify({
        companyName: "Watcon International",
        officeAddress: data.office.address,
        rates: { BIKE: 4, CAR: 11, CAB: 0, AUTO: 0, METRO: 0, BUS: 0, metroFlat: 60, busFlat: 30, busMetroPerKm: 3 },
        geofenceRadius: 200,
        forgotPunchoutHours: 10,
        settingsPin: "1234",
      }),
    },
  });

  console.log("→ Head office…");
  await prisma.site.create({
    data: {
      code: "OFFICE",
      name: data.office.name,
      address: data.office.address,
      pincode: data.office.pincode,
      city: data.office.city,
      state: data.office.state,
      region: "Delhi NCR",
      zone: "HQ",
      latitude: data.office.lat,
      longitude: data.office.lng,
      geofenceRadius: 200,
      isOffice: true,
    },
  });

  console.log(`→ ${data.sites.length} sites…`);
  for (const s of data.sites) {
    await prisma.site.create({
      data: {
        code: `SITE-${pad(s.sno, 3)}`,
        name: s.name,
        address: s.address,
        pincode: s.pincode,
        city: s.city,
        state: s.state,
        region: s.state === "Delhi" || s.state === "Haryana" ? "Delhi NCR" : s.state,
        zone: s.city,
        latitude: s.lat,
        longitude: s.lng,
        geofenceRadius: s.geofenceRadius,
      },
    });
  }

  console.log(`→ ${data.employees.length} employees…`);
  for (const e of data.employees) {
    await prisma.employee.create({
      data: {
        employeeCode: `WAT-${pad(e.sno)}`,
        name: e.name,
        department: e.department,
        designation: e.designation,
        vehicleType: e.vehicleType,
      },
    });
  }

  console.log("✔ Recording database ready.");
  const demo = await prisma.employee.findFirst({ where: { name: DEMO_EMPLOYEE_NAME } });
  console.log(`  Demo employee: ${demo?.name ?? "(not found)"} — starts the day with a clean journey.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
