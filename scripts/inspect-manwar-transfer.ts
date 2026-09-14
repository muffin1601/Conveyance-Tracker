import { prisma } from "../src/lib/prisma";

async function main() {
  const source = await prisma.employee.findFirstOrThrow({
    where: { name: { equals: "Manwar singh Rawat", mode: "insensitive" } },
    select: { id: true, name: true, employeeCode: true, userId: true },
  });
  const destination = await prisma.employee.findFirstOrThrow({
    where: { name: { equals: "Mohmd Soyab", mode: "insensitive" } },
    select: { id: true, name: true, employeeCode: true, userId: true },
  });
  const journeys = await prisma.journey.findMany({
    where: { employeeId: { in: [source.id, destination.id] } },
    orderBy: [{ workDate: "asc" }, { createdAt: "asc" }, { sequence: "asc" }],
    select: { employeeId: true, workDate: true, sequence: true, createdAt: true },
  });
  const dates = [...new Set(journeys.filter((journey) => journey.employeeId === source.id).map((journey) => journey.workDate))];
  const summary = dates.map((workDate) => ({
    workDate,
    source: journeys.filter((journey) => journey.workDate === workDate && journey.employeeId === source.id).length,
    destination: journeys.filter((journey) => journey.workDate === workDate && journey.employeeId === destination.id).length,
  }));
  console.log(JSON.stringify({ source: source.name, destination: destination.name, summary }, null, 2));
}

void main().finally(() => prisma.$disconnect());
