import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getActiveEmployees, getActiveSites, getHeadOffice } from "@/lib/masterData";
import { getActiveEmployeeId } from "@/app/actions/session";
import { getLanguage } from "@/app/actions/language";
import { t } from "@/lib/i18n";
import { todayKey, inr, km, fmtTime } from "@/lib/utils";
import { LOCATION_TYPE_LABEL, MISC_CATEGORY_LABEL, type LocationType, type MiscCategory } from "@/lib/enums";
import { legFromName, legToName } from "@/lib/journeyEndpoint";
import { isUploadConfigured } from "@/lib/storage";
import { Card, SectionTitle, Empty, SummarySkeleton } from "@/components/ui";
import { NavigateButton } from "@/components/NavigateButton";
import { ArrowRight } from "lucide-react";
import { CheckinForm } from "./CheckinForm";
import { MiscExpenses } from "./MiscExpenses";
import { JourneyBill } from "./JourneyBill";

/**
 * Today's summary must reflect the live database, not a build-time snapshot.
 * Without this the route prerenders statically (every data source it touches
 * is either cached or a plain query), which would freeze `workDate` at build
 * time and show yesterday's activity after midnight. The shell stays fast
 * regardless: `VisitEntry` reads only cached master data, so it streams
 * immediately while the summary resolves behind its Suspense boundary.
 */
export const dynamic = "force-dynamic";

function modeLabel(m: string): string {
  return m === "BUSMETRO" ? "Bus/Metro" : m === "CAR" ? "Car" : m === "BIKE" ? "Bike" : m;
}

/**
 * The interactive half of the page. Only depends on cached master data, so it
 * renders as soon as the request arrives instead of waiting for the day's
 * activity query — that wait was the bulk of the perceived "the app is slow"
 * delay, and it grows with every visit ever logged.
 */
async function VisitEntry() {
  const [employees, sites, office, settings, activeEmployeeId, lang] = await Promise.all([
    getActiveEmployees(),
    getActiveSites(),
    getHeadOffice(),
    getSettings(),
    getActiveEmployeeId(),
    getLanguage(),
  ]);
  // Only pre-select someone who is still on the active roster.
  const initialEmployeeId =
    activeEmployeeId && employees.some((e) => e.id === activeEmployeeId) ? activeEmployeeId : "";
  const uploadsEnabled = isUploadConfigured();

  return (
    <>
      <Card>
        <SectionTitle>{t(lang, "logSiteVisit")}</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">
          {t(lang, "introFirstTrip", { office: office?.name ?? "the head office" })}
        </p>
        <CheckinForm
          lang={lang}
          initialEmployeeId={initialEmployeeId}
          employees={employees}
          sites={sites}
          officeName={office?.name ?? "Head Office"}
          companyRadius={settings.geofenceRadius}
          rates={{ BIKE: settings.rates.BIKE, CAR: settings.rates.CAR, BUSMETRO: settings.rates.busMetroPerKm }}
        />
      </Card>

      <Card>
        <SectionTitle>{t(lang, "miscExpensesTitle")}</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">
          {t(lang, "miscExpensesIntro")}
        </p>
        <MiscExpenses lang={lang} initialEmployeeId={initialEmployeeId} employees={employees} uploadsEnabled={uploadsEnabled} />
      </Card>
    </>
  );
}

/**
 * Today's activity for the person using this device only.
 *
 * Previously this listed every employee's trips and expenses to anyone who
 * opened the page. It is now scoped to whoever is selected in the form above
 * (remembered in a cookie), so you only ever see your own day. Managers see
 * everybody through the PIN-gated Admin tab, which is unchanged.
 */
async function TodaySummary() {
  const workDate = todayKey();
  const [employeeId, lang] = await Promise.all([getActiveEmployeeId(), getLanguage()]);

  // No name chosen yet — show nothing rather than everyone's data.
  if (!employeeId) {
    return (
      <Empty>{t(lang, "selectNameToSeeTrips")}</Empty>
    );
  }

  const scope = { workDate, employeeId };
  const [journeys, miscExpenses] = await Promise.all([
    prisma.journey.findMany({
      where: scope,
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
      where: scope,
      include: { employee: { select: { id: true, name: true } } },
    }),
  ]);

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

  if (timelines.length === 0) return <Empty>{t(lang, "noActivityToday")}</Empty>;

  return (
    <div className="space-y-5">
      {timelines.map((day) => (
        <div key={day.employeeId} className="rounded-lg border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">{day.name}</span>
            <span className="text-xs text-muted tabular-nums">{fmtTime(day.lastAt)}</span>
          </div>

          {day.legs.length > 0 && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{t(lang, "conveyanceLabel")}</div>
              <ol className="space-y-1.5">
                {day.legs.map((j, i) => (
                  <li key={j.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-semibold tabular-nums text-muted">{i + 1}.</span>
                        <span className="text-muted truncate">{legFromName(j)}</span>
                        <ArrowRight className="h-3 w-3 text-muted shrink-0" />
                        <span className="truncate">{legToName(j)}</span>
                        {j.locationType !== "MASTER" && (
                          <span className="badge bg-bg text-muted text-[10px] shrink-0">
                            {LOCATION_TYPE_LABEL[j.locationType as LocationType]}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 pl-3">
                        <span className="text-right tabular-nums">
                          {km(j.distanceKm)} · {inr(j.amount)}
                          <span className="ml-1 text-xs text-muted">{modeLabel(j.vehicleType)}</span>
                        </span>
                        <NavigateButton lat={j.toLat} lng={j.toLng} compact />
                      </div>
                    </div>
                    {uploadsEnabled && (
                      <div className="mt-0.5 pl-0.5">
                        <JourneyBill
                          journeyId={j.id}
                          employeeId={day.employeeId}
                          billPath={j.billPath}
                          billName={j.billName}
                          billType={j.billType}
                          uploadsEnabled={uploadsEnabled}
                          lang={lang}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="flex items-center justify-between mt-1.5 text-sm tabular-nums">
                <span className="text-muted">{t(lang, "totalConveyanceLabel")}</span>
                <span className="font-medium">{km(day.totalKm)} · {inr(day.convTotal)}</span>
              </div>
            </>
          )}

          {day.misc.length > 0 && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-1 mt-3">{t(lang, "miscellaneousLabel")}</div>
              <ul className="space-y-1.5">
                {day.misc.map((e) => (
                  <li key={e.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{miscCatLabel(e)}{e.description ? ` · ${e.description}` : ""}</span>
                    <span className="tabular-nums pl-3 shrink-0">{inr(e.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between mt-1.5 text-sm tabular-nums">
                <span className="text-muted">{t(lang, "totalMiscLabel")}</span>
                <span className="font-medium">{inr(day.miscTotal)}</span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between mt-2 pt-2 border-t text-sm font-semibold tabular-nums">
            <span>{t(lang, "grandTotal")}</span>
            <span>{inr(day.convTotal + day.miscTotal)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function CheckinPage() {
  const lang = await getLanguage();
  return (
    <div className="space-y-6">
      <VisitEntry />

      <Card>
        <SectionTitle>{t(lang, "todaysSummary")}</SectionTitle>
        <Suspense fallback={<SummarySkeleton />}>
          <TodaySummary />
        </Suspense>
      </Card>
    </div>
  );
}
