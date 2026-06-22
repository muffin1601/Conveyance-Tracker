import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { todayKey, inr, km, fmtTime } from "@/lib/utils";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { ArrowRight } from "lucide-react";
import { CheckinForm } from "./CheckinForm";

function modeLabel(m: string): string {
  return m === "BUSMETRO" ? "Bus/Metro" : m === "CAR" ? "Car" : m === "BIKE" ? "Bike" : m;
}

export default async function CheckinPage() {
  const workDate = todayKey();
  const [employees, office, sites, settings, journeys] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, designation: true, department: true },
    }),
    prisma.site.findFirst({ where: { isOffice: true }, select: { name: true, address: true } }),
    prisma.site.findMany({
      where: { status: "ACTIVE", isOffice: false, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true, address: true },
    }),
    getSettings(),
    prisma.journey.findMany({
      where: { workDate },
      orderBy: { sequence: "asc" },
      include: {
        employee: { select: { id: true, name: true } },
        fromSite: { select: { name: true } },
        toSite: { select: { name: true, city: true } },
      },
    }),
  ]);

  // Group today's legs into one timeline per employee.
  const byEmployee = new Map<
    string,
    { name: string; legs: typeof journeys; totalKm: number; totalAmount: number; lastAt: Date }
  >();
  for (const j of journeys) {
    const g = byEmployee.get(j.employee.id) ?? {
      name: j.employee.name,
      legs: [] as typeof journeys,
      totalKm: 0,
      totalAmount: 0,
      lastAt: j.createdAt,
    };
    g.legs.push(j);
    g.totalKm += j.distanceKm;
    g.totalAmount += j.amount;
    if (j.createdAt > g.lastAt) g.lastAt = j.createdAt;
    byEmployee.set(j.employee.id, g);
  }
  const timelines = [...byEmployee.values()].sort((a, b) => +b.lastAt - +a.lastAt);

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Log Site Visit</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">
          Your first trip starts from {office?.name ?? "the head office"}. After that, each visit
          starts from the last site you punched. Distance &amp; amount are calculated automatically.
        </p>
        <CheckinForm
          employees={employees}
          sites={sites}
          officeName={office?.name ?? "Head Office"}
          officeAddress={office?.address ?? ""}
          rates={{ BIKE: settings.rates.BIKE, CAR: settings.rates.CAR, BUSMETRO: settings.rates.busMetroPerKm }}
        />
      </Card>

      <Card>
        <SectionTitle>Today&apos;s Journeys</SectionTitle>
        {timelines.length === 0 ? (
          <Empty>No visits logged today yet.</Empty>
        ) : (
          <div className="space-y-5">
            {timelines.map((t) => (
              <div key={t.name} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{t.name}</span>
                  <span className="text-xs text-muted tabular-nums">{fmtTime(t.lastAt)}</span>
                </div>
                <ol className="space-y-1.5">
                  {t.legs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-muted truncate">{j.fromSite.name}</span>
                        <ArrowRight className="h-3 w-3 text-muted shrink-0" />
                        <span className="truncate">{j.toSite.name}</span>
                      </div>
                      <div className="text-right shrink-0 pl-3 tabular-nums">
                        {km(j.distanceKm)} · {inr(j.amount)}
                        <span className="text-xs text-muted ml-1">{modeLabel(j.vehicleType)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="flex items-center justify-between mt-2 pt-2 border-t text-sm font-medium tabular-nums">
                  <span>Total</span>
                  <span>{km(t.totalKm)} · {inr(t.totalAmount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
