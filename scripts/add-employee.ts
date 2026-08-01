/**
 * Add a member of staff to the roster.
 *
 * The app has no employee-management screen, so new joiners are added here.
 * The next WAT-#### code is allocated automatically, and the script refuses to
 * create a duplicate name so re-running it is safe.
 *
 *   npx tsx scripts/add-employee.ts "Gayatri"
 *   npx tsx scripts/add-employee.ts "Gayatri" --designation "Electrician" \
 *       --department Electrical --vehicle CAR
 *
 * Vehicle type sets the reimbursement rate (BIKE ₹4/km, CAR ₹11/km), so it is
 * worth getting right — pass --vehicle CAR for anyone who drives.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const VEHICLES = ["BIKE", "CAR", "CAB", "AUTO", "METRO", "BUS"] as const;
type Vehicle = (typeof VEHICLES)[number];

const argv = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const name = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);
const designation = flag("designation", "Field Staff");
const department = flag("department", "Operations");
const vehicle = flag("vehicle", "BIKE").toUpperCase() as Vehicle;

async function main() {
  if (!name) {
    console.error('Usage: npx tsx scripts/add-employee.ts "Full Name" [--designation X] [--department Y] [--vehicle BIKE|CAR]');
    process.exit(1);
  }
  if (!VEHICLES.includes(vehicle)) {
    console.error(`--vehicle must be one of: ${VEHICLES.join(", ")}`);
    process.exit(1);
  }

  // Compared in memory rather than with Prisma's Postgres-only
  // `mode: "insensitive"`, so this script also runs against SQLite.
  const roster = await prisma.employee.findMany({
    where: { deletedAt: null },
    select: { employeeCode: true, name: true, status: true },
  });
  const clash = roster.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (clash) {
    console.log(`Already on the roster: ${clash.employeeCode} — ${clash.name} (${clash.status}). Nothing to do.`);
    return;
  }

  // Allocate the next free WAT-#### rather than assuming count + 1, so a gap
  // from a previous deletion can never cause a unique-constraint failure.
  const used = new Set(roster.map((c) => c.employeeCode));
  let n = 1;
  while (used.has(`WAT-${String(n).padStart(4, "0")}`)) n++;
  const employeeCode = `WAT-${String(n).padStart(4, "0")}`;

  const created = await prisma.employee.create({
    data: {
      employeeCode,
      name: name.trim(),
      designation,
      department,
      vehicleType: vehicle,
      status: "ACTIVE",
    },
    select: { id: true, employeeCode: true, name: true, designation: true, department: true, vehicleType: true },
  });

  console.log("Added:");
  console.log(`  ${created.employeeCode}  ${created.name}`);
  console.log(`  ${created.designation} / ${created.department} / ${created.vehicleType}`);
  console.log(`  id: ${created.id}`);
  console.log(`\nRoster is now ${await prisma.employee.count({ where: { status: "ACTIVE", deletedAt: null } })} active staff.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
