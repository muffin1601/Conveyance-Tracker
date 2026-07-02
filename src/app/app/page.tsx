import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { todayKey, inr, km, fmtTime } from "@/lib/utils";
import { LOCATION_TYPE_LABEL, MISC_CATEGORY_LABEL, type LocationType, type MiscCategory } from "@/lib/enums";
import { legFromName, legToName } from "@/lib/journeyEndpoint";
import { isUploadConfigured } from "@/lib/storage";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { ArrowRight } from "lucide-react";
import { CheckinForm } from "./CheckinForm";
import { MiscExpenses } from "./MiscExpenses";
import { JourneyBill } from "./JourneyBill";

function modeLabel(m: string): string {
  return m === "BUSMETRO" ? "Bus/Metro" : m === "CAR" ? "Car" : m === "BIKE" ? "Bike" : m;
}

export default async function CheckinPage() {
  const workDate = todayKey();
  const [employees, office, sites, settings, journeys, miscExpenses] = await Promise.all([
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
        fromCustomLocation: { select: { locationName: true } },
        toCustomLocation: { select: { locationName: true } },
      },
    }),
    prisma.miscellaneousExpense.findMany({
      where: { workDate },
      include: { employee: { select: { id: true, name: true } } },
    }),
  ]);

  // Group today's activity into one timeline per employee: conveyance legs,
  // miscellaneous expenses, and a grand total.
  const uploadsEnabled = isUploadConfigured();

  interface Group {
    employeeId: string;
    name: string;
    legs: typeof journeys;
    misc: typeof miscExpenses;
    convTotal: number;
    miscTotal: number;
    totalKm: number;
    lastAt: Date;
  }
  const byEmployee = new Map<string, Group>();
  const ensure = (id: string, name: string, at: Date): Group => {
    let g = byEmployee.get(id);
    if (!g) {
      g = { employeeId: id, name, legs: [], misc: [], convTotal: 0, miscTotal: 0, totalKm: 0, lastAt: at };
      byEmployee.set(id, g);
    }
    if (at > g.lastAt) g.lastAt = at;
    return g;
  };
  for (const j of journeys) {
    const g = ensure(j.employee.id, j.employee.name, j.createdAt);
    g.legs.push(j);
    g.totalKm += j.distanceKm;
    g.convTotal += j.amount;
  }
  for (const e of miscExpenses) {
    const g = ensure(e.employee.id, e.employee.name, e.createdAt);
    g.misc.push(e);
    g.miscTotal += e.amount;
  }
  const timelines = [...byEmployee.values()].sort((a, b) => +b.lastAt - +a.lastAt);

  const miscCatLabel = (e: (typeof miscExpenses)[number]) =>
    e.category === "OTHER" ? (e.customCategory || "Other") : MISC_CATEGORY_LABEL[e.category as MiscCategory] ?? e.category;

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>Log Site Visit</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">
          Your first trip starts from {office?.name ?? "the head office"}. After that, each visit
          starts from your last location. Distance &amp; amount are calculated automatically.
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
        <SectionTitle>Miscellaneous Expenses</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">
          Record non-conveyance expenses — parking, toll, food, and more. These are kept separate
          from conveyance but appear in your day summary and reports.
        </p>
        <MiscExpenses employees={employees} uploadsEnabled={uploadsEnabled} />
      </Card>

      <Card>
        <SectionTitle>Today&apos;s Summary</SectionTitle>
        {timelines.length === 0 ? (
          <Empty>No activity logged today yet.</Empty>
        ) : (
          <div className="space-y-5">
            {timelines.map((t) => (
              <div key={t.name} className="rounded-lg border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{t.name}</span>
                  <span className="text-xs text-muted tabular-nums">{fmtTime(t.lastAt)}</span>
                </div>

                {t.legs.length > 0 && (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">Conveyance</div>
                    <ol className="space-y-1.5">
                      {t.legs.map((j: (typeof journeys)[number]) => (
                        <li key={j.id} className="text-sm">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-muted truncate">{legFromName(j)}</span>
                              <ArrowRight className="h-3 w-3 text-muted shrink-0" />
                              <span className="truncate">{legToName(j)}</span>
                              {j.locationType !== "MASTER" && (
                                <span className="badge bg-bg text-muted text-[10px] shrink-0">{LOCATION_TYPE_LABEL[j.locationType as LocationType]}</span>
                              )}
                            </div>
                            <div className="text-right shrink-0 pl-3 tabular-nums">
                              {km(j.distanceKm)} · {inr(j.amount)}
                              <span className="text-xs text-muted ml-1">{modeLabel(j.vehicleType)}</span>
                            </div>
                          </div>
                          {uploadsEnabled && (
                            <div className="mt-0.5 pl-0.5">
                              <JourneyBill
                                journeyId={j.id}
                                employeeId={t.employeeId}
                                billPath={j.billPath}
                                billName={j.billName}
                                billType={j.billType}
                                uploadsEnabled={uploadsEnabled}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                    <div className="flex items-center justify-between mt-1.5 text-sm tabular-nums">
                      <span className="text-muted">Total Conveyance</span>
                      <span className="font-medium">{km(t.totalKm)} · {inr(t.convTotal)}</span>
                    </div>
                  </>
                )}

                {t.misc.length > 0 && (
                  <>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1 mt-3">Miscellaneous</div>
                    <ul className="space-y-1.5">
                      {t.misc.map((e: (typeof miscExpenses)[number]) => (
                        <li key={e.id} className="flex items-center justify-between text-sm">
                          <span className="truncate">{miscCatLabel(e)}{e.description ? ` · ${e.description}` : ""}</span>
                          <span className="tabular-nums pl-3 shrink-0">{inr(e.amount)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between mt-1.5 text-sm tabular-nums">
                      <span className="text-muted">Total Miscellaneous</span>
                      <span className="font-medium">{inr(t.miscTotal)}</span>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between mt-2 pt-2 border-t text-sm font-semibold tabular-nums">
                  <span>Grand Total</span>
                  <span>{inr(t.convTotal + t.miscTotal)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
