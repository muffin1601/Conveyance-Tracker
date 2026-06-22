import { prisma } from "./prisma";
import { todayKey, monthKey } from "./utils";

export async function dashboardStats() {
  const today = todayKey();
  const month = monthKey();

  const [
    activeEmployees,
    todaysVisits,
    todaysJourneys,
    monthJourneys,
    pendingApprovals,
    monthClaims,
    rejectedClaims,
    paidClaims,
    totalClaims,
  ] = await Promise.all([
    prisma.siteVisit.findMany({
      where: { workDate: today },
      select: { employeeId: true },
      distinct: ["employeeId"],
    }),
    prisma.siteVisit.count({ where: { workDate: today } }),
    prisma.journey.aggregate({ where: { workDate: today }, _sum: { distanceKm: true, amount: true } }),
    prisma.journey.aggregate({ where: { workDate: { startsWith: month } }, _sum: { distanceKm: true, amount: true } }),
    prisma.claim.count({ where: { status: { in: ["SUBMITTED", "MANAGER_APPROVED", "ADMIN_APPROVED", "FINANCE_APPROVED"] } } }),
    prisma.claim.aggregate({ where: { periodMonth: month }, _sum: { totalAmount: true } }),
    prisma.claim.count({ where: { status: "REJECTED" } }),
    prisma.claim.count({ where: { status: "PAID" } }),
    prisma.claim.count(),
  ]);

  const approvalRate = totalClaims > 0 ? Math.round((paidClaims / totalClaims) * 100) : 0;
  const avgKm = todaysVisits > 0 ? (todaysJourneys._sum.distanceKm ?? 0) / activeEmployees.length || 0 : 0;

  return {
    activeEmployees: activeEmployees.length,
    todaysVisits,
    todayKm: todaysJourneys._sum.distanceKm ?? 0,
    todayAmount: todaysJourneys._sum.amount ?? 0,
    monthKm: monthJourneys._sum.distanceKm ?? 0,
    monthAmount: monthJourneys._sum.amount ?? 0,
    pendingApprovals,
    monthClaims: monthClaims._sum.totalAmount ?? 0,
    rejectedClaims,
    approvalRate,
    avgKm,
  };
}

export async function topTravellers(period = monthKey(), limit = 5) {
  const rows = await prisma.journey.groupBy({
    by: ["employeeId"],
    where: { workDate: { startsWith: period } },
    _sum: { distanceKm: true, amount: true },
    orderBy: { _sum: { distanceKm: "desc" } },
    take: limit,
  });
  const emps = await prisma.employee.findMany({
    where: { id: { in: rows.map((r) => r.employeeId) } },
    select: { id: true, name: true, department: true },
  });
  const map = new Map(emps.map((e) => [e.id, e]));
  return rows.map((r) => ({
    name: map.get(r.employeeId)?.name ?? "—",
    department: map.get(r.employeeId)?.department ?? "",
    km: r._sum.distanceKm ?? 0,
    amount: r._sum.amount ?? 0,
  }));
}

export async function mostVisitedSites(period = monthKey(), limit = 5) {
  const rows = await prisma.siteVisit.groupBy({
    by: ["siteId"],
    where: { workDate: { startsWith: period } },
    _count: { _all: true },
    orderBy: { _count: { siteId: "desc" } },
    take: limit,
  });
  const sites = await prisma.site.findMany({
    where: { id: { in: rows.map((r) => r.siteId) } },
    select: { id: true, name: true, city: true },
  });
  const map = new Map(sites.map((s) => [s.id, s]));
  return rows.map((r) => ({
    name: map.get(r.siteId)?.name ?? "—",
    city: map.get(r.siteId)?.city ?? "",
    visits: r._count._all,
  }));
}
