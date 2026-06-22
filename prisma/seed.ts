import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

interface SeedData {
  office: { name: string; address: string; pincode: string; lat: number; lng: number; city: string; state: string };
  sites: { sno: number; name: string; address: string; pincode: string | null; lat: number; lng: number; city: string; state: string; geofenceRadius: number }[];
  employees: { sno: number; name: string; rawName: string; designation: string; department: string; vehicleType: string }[];
}

function pad(n: number, w = 4) {
  return String(n).padStart(w, "0");
}

async function main() {
  const data: SeedData = JSON.parse(
    readFileSync(join(process.cwd(), "data", "seed-data.json"), "utf8"),
  );

  console.log("→ Clearing existing data…");
  await prisma.$transaction([
    prisma.approval.deleteMany(),
    prisma.claimItem.deleteMany(),
    prisma.claim.deleteMany(),
    prisma.journey.deleteMany(),
    prisma.siteVisit.deleteMany(),
    prisma.distanceCache.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.session.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.site.deleteMany(),
    prisma.user.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  // ── Settings ────────────────────────────────────────────
  await prisma.setting.create({
    data: {
      key: "company",
      value: JSON.stringify({
        companyName: "Watcon International",
        officeAddress: data.office.address,
        rates: { BIKE: 4, CAR: 11, CAB: 0, AUTO: 0, METRO: 0, BUS: 0, metroFlat: 60, busFlat: 30 },
        geofenceRadius: 200,
        forgotPunchoutHours: 10,
      }),
    },
  });

  // ── Office (a Site flagged isOffice) ────────────────────
  console.log("→ Creating head office…");
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

  // ── Sites ───────────────────────────────────────────────
  console.log(`→ Importing ${data.sites.length} sites…`);
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

  // ── Privileged users ────────────────────────────────────
  console.log("→ Creating admin users…");
  const pw = await bcrypt.hash("watcon123", 10);
  const superAdmin = await prisma.user.create({
    data: { email: "superadmin@watcon.net", passwordHash: pw, name: "Super Admin", role: "SUPER_ADMIN" },
  });
  const admin = await prisma.user.create({
    data: { email: "admin@watcon.net", passwordHash: pw, name: "Operations Admin", role: "ADMIN" },
  });

  // First employee becomes a Manager who also has a login.
  // ── Employees (+ employee logins) ───────────────────────
  console.log(`→ Importing ${data.employees.length} employees…`);
  const created: { id: string; sno: number }[] = [];

  // Manager: promote the supervisor / first office staff as team manager.
  const managerSeed = data.employees.find((e) => e.designation === "Site Supervisor") ?? data.employees[0];

  for (const e of data.employees) {
    const isManager = e.sno === managerSeed.sno;
    const code = `WAT-${pad(e.sno)}`;
    const emailSlug = e.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
    const email = `${emailSlug || "emp" + e.sno}.${e.sno}@watcon.net`;

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: pw,
        name: e.name,
        role: isManager ? "MANAGER" : "EMPLOYEE",
      },
    });

    const emp = await prisma.employee.create({
      data: {
        employeeCode: code,
        name: e.name,
        email,
        department: e.department,
        designation: e.designation,
        vehicleType: e.vehicleType,
        userId: user.id,
      },
    });
    created.push({ id: emp.id, sno: e.sno });
  }

  // Wire reporting: everyone (except the manager) reports to the manager.
  const managerEmp = created.find((c) => c.sno === managerSeed.sno)!;
  await prisma.employee.updateMany({
    where: { id: { notIn: [managerEmp.id] } },
    data: { managerId: managerEmp.id },
  });

  console.log("\n✔ Seed complete.");
  console.log("  Sites:    ", data.sites.length, "(+1 office)");
  console.log("  Employees:", data.employees.length);
  console.log("\n  Logins (password: watcon123):");
  console.log("   • superadmin@watcon.net  (Super Admin)");
  console.log("   • admin@watcon.net       (Admin)");
  console.log(`   • manager: ${managerSeed.name} — see employee list`);
  console.log("   • every employee has a login (email shown in Admin → Employees)");
  void superAdmin;
  void admin;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
