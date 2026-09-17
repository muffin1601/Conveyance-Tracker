import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const workDate = "2026-09-02";
const expenses = [
  {
    amount: 100,
    description: "Rapido Auto: CJ LIVING to 844, Mehrauli-Gurgaon Rd",
    notes: "Ride ID RD17883437573895261 · 03:39 PM · 2.0 km · estimated fare ₹100",
  },
  {
    amount: 73,
    description: "Rapido Bike: 846/2, Gadaipur to 9141-9144, Masoodpur",
    notes: "Ride ID RD17883472132811396 · 04:36 PM · 7.1 km · fare ₹73",
  },
  {
    amount: 139,
    description: "Rapido Auto: B9 LIG Flats, Masoodpur to Diwans Home, Block B",
    notes: "Ride ID RD17883497924386035 · 05:19 PM · 9.6 km · estimated fare ₹139",
  },
];

async function main() {
  const employee = await prisma.employee.findFirst({
    where: { name: { equals: "Manisha Gupta", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!employee) throw new Error("Manisha Gupta was not found.");

  const created = [];
  for (const expense of expenses) {
    const existing = await prisma.miscellaneousExpense.findFirst({
      where: { employeeId: employee.id, workDate, description: expense.description },
    });
    if (existing) {
      created.push({ status: "already-exists", id: existing.id, amount: existing.amount, description: existing.description });
      continue;
    }
    const row = await prisma.miscellaneousExpense.create({
      data: {
        employeeId: employee.id,
        workDate,
        category: "OTHER",
        customCategory: "Local travel",
        amount: expense.amount,
        description: expense.description,
        notes: expense.notes,
      },
      select: { id: true, amount: true, description: true },
    });
    created.push({ status: "created", ...row });
  }
  console.log(JSON.stringify({ employee: employee.name, workDate, created }, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
