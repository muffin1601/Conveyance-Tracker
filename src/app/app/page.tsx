import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getActiveEmployees, getActiveSites, getHeadOffice } from "@/lib/masterData";
import { getActiveEmployeeId } from "@/app/actions/session";
import { getLanguage } from "@/app/actions/language";
import { t } from "@/lib/i18n";
import { todayKey, monthKey, inr, km, fmtTime } from "@/lib/utils";
import { LOCATION_TYPE_LABEL, MISC_CATEGORY_LABEL, type LocationType, type MiscCategory } from "@/lib/enums";
import { legFromName, legToName } from "@/lib/journeyEndpoint";
import { isUploadConfigured } from "@/lib/storage";
import { Card, SectionTitle, Empty, SummarySkeleton } from "@/components/ui";
import { NavigateButton } from "@/components/NavigateButton";
import { DayMap, type DayStop } from "@/components/DayMap";
import { haversineMeters, isValidCoord } from "@/lib/gps";
import { ArrowDown, ArrowRight } from "lucide-react";
import { CheckinForm } from "./CheckinForm";
import { MiscExpenses } from "./MiscExpenses";
import { JourneyBill } from "./JourneyBill";
import { DistanceCorrection } from "./DistanceCorrection";

/** Keep dates and totals live across midnight and month boundaries. */
export const dynamic = "force-dynamic";

/** The entry forms render while the employee's monthly summary streams. */
async function VisitEntry() {
  const [employees, sites, office, settings, activeEmployeeId, lang] = await Promise.all([
    getActiveEmployees(),
    getActiveSites(),
    getHeadOffice(),
    getSettings(),
    getActiveEmployeeId(),
    getLanguage(),
  ]);
  const initialEmployeeId =
    activeEmployeeId && employees.some((employee) => employee.id === activeEmployeeId)
      ? activeEmployeeId
      : "";

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
          rates={{
            BIKE: settings.rates.BIKE,
            CAR: settings.rates.CAR,
            BUSMETRO: settings.rates.busMetroPerKm,
          }}
        />
      </Card>

      <Card>
        <SectionTitle>{t(lang, "miscExpensesTitle")}</SectionTitle>
        <p className="text-xs text-muted -mt-2 mb-4">{t(lang, "miscExpensesIntro")}</p>
        <MiscExpenses
          lang={lang}
          initialEmployeeId={initialEmployeeId}
          employees={employees}
          uploadsEnabled={isUploadConfigured()}
        />
      </Card>
    </>
  );
}

function modeLabel(mode: string): string {
  return mode === "BUSMETRO" ? "Bus/Metro" : mode === "CAR" ? "Car" : mode === "BIKE" ? "Bike" : mode;
}

/** Current-day activity for the employee selected on this device. */
async function TodaySummary() {
  const workDate = todayKey();
  const [employeeId, lang] = await Promise.all([getActiveEmployeeId(), getLanguage()]);

  if (!employeeId) return <Empty>{t(lang, "selectNameToSeeTrips")}</Empty>;

  const scope = { workDate, employeeId };
  const [journeys, miscExpenses] = await Promise.all([
    prisma.journey.findMany({
      where: scope,
      orderBy: { sequence: "asc" },
      include: {
        employee: { select: { id: true, name: true } },
        fromSite: { select: { name: true, latitude: true, longitude: true } },
        toSite: { select: { name: true, city: true, latitude: true, longitude: true } },
        fromCustomLocation: { select: { locationName: true, latitude: true, longitude: true } },
        toCustomLocation: { select: { locationName: true, latitude: true, longitude: true } },
        distanceCorrection: {
          select: { id: true, status: true, submittedDistanceKm: true, finalDistanceKm: true },
        },
      },
    }),
    prisma.miscellaneousExpense.findMany({
      where: scope,
      include: { employee: { select: { id: true, name: true } } },
    }),
  ]);

  if (journeys.length === 0 && miscExpenses.length === 0) {
    return <Empty>{t(lang, "noActivityToday")}</Empty>;
  }

  const uploadsEnabled = isUploadConfigured();
  const employeeName = journeys[0]?.employee.name ?? miscExpenses[0]?.employee.name ?? "";
  const mapStops: DayStop[] = [];
  const addMapStop = (name: string, latitude: number | null, longitude: number | null) => {
    if (latitude == null || longitude == null || !isValidCoord(latitude, longitude)) return;
    const previous = mapStops.at(-1);
    if (previous && haversineMeters(
      { lat: previous.latitude, lng: previous.longitude },
      { lat: latitude, lng: longitude },
    ) < 30) return;
    mapStops.push({ order: mapStops.length + 1, name, latitude, longitude });
  };
  for (const journey of journeys) {
    addMapStop(
      legFromName(journey),
      journey.fromLat ?? journey.fromSite?.latitude ?? journey.fromCustomLocation?.latitude ?? null,
      journey.fromLng ?? journey.fromSite?.longitude ?? journey.fromCustomLocation?.longitude ?? null,
    );
    addMapStop(
      legToName(journey),
      journey.toLat ?? journey.toSite?.latitude ?? journey.toCustomLocation?.latitude ?? null,
      journey.toLng ?? journey.toSite?.longitude ?? journey.toCustomLocation?.longitude ?? null,
    );
  }
  const totalKm = journeys.reduce((sum, journey) => sum + journey.distanceKm, 0);
  const conveyanceTotal = journeys.reduce((sum, journey) => sum + journey.amount, 0);
  const miscellaneousTotal = miscExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const lastAt = [...journeys, ...miscExpenses]
    .map((entry) => entry.createdAt)
    .sort((a, b) => +b - +a)[0];

  const miscCategoryLabel = (expense: (typeof miscExpenses)[number]) =>
    expense.category === "OTHER"
      ? (expense.customCategory || "Other")
      : MISC_CATEGORY_LABEL[expense.category as MiscCategory] ?? expense.category;

  return (
    <div className="min-w-0 rounded-lg border p-2.5 sm:p-4">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold">{employeeName}</span>
        {lastAt && <span className="text-xs tabular-nums text-muted">{fmtTime(lastAt)}</span>}
      </div>

      {journeys.length > 0 && (
        <>
          {mapStops.length > 0 ? (
            <DayMap stops={mapStops} label={t(lang, "dayMapLabel")} caption={t(lang, "dayMapCaption")} />
          ) : (
            <p className="rounded-md bg-bg px-3 py-2 text-xs text-muted">
              {t(lang, "dayMapUnavailable")}
            </p>
          )}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {t(lang, "conveyanceLabel")}
          </div>
          <ol className="space-y-3">
            {journeys.map((journey, index) => (
              <li key={journey.id} className="min-w-0 rounded-lg border bg-bg/50 p-3 text-sm sm:p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
                    Trip {index + 1}
                  </span>
                  <span className="text-xs tabular-nums text-muted">{fmtTime(journey.createdAt)}</span>
                  <span className="badge bg-surface text-[10px] text-muted">{modeLabel(journey.vehicleType)}</span>
                  <span className="ml-auto">
                    {journey.locationType !== "MASTER" && (
                      <span className="badge bg-surface text-[10px] text-muted">
                        {LOCATION_TYPE_LABEL[journey.locationType as LocationType]}
                      </span>
                    )}
                  </span>
                </div>

                <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 rounded-md bg-surface p-3">
                    <div className="min-w-0 sm:flex sm:items-center sm:gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                          {t(lang, "startingPoint")}
                        </div>
                        <div className="mt-0.5 break-words font-medium text-muted">{legFromName(journey)}</div>
                      </div>
                      <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted sm:block" />
                      <ArrowDown className="my-2 h-4 w-4 text-muted sm:hidden" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                          {t(lang, "destination")}
                        </div>
                        <div className="mt-0.5 break-words font-semibold" title={journey.toAddress ?? undefined}>
                          {legToName(journey)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <NavigateButton
                    lat={journey.toLat}
                    lng={journey.toLng}
                    address={journey.toAddress}
                    className="min-h-11 w-full justify-center sm:w-auto"
                  />
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center tabular-nums">
                  <div className="min-w-0 rounded-md bg-surface px-1.5 py-2.5">
                    <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">
                      {t(lang, "distance")}
                    </dt>
                    <dd className="mt-1 truncate font-semibold">{km(journey.distanceKm)}</dd>
                  </div>
                  <div className="min-w-0 rounded-md bg-surface px-1.5 py-2.5">
                    <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">
                      {t(lang, "conveyanceAmount")}
                    </dt>
                    <dd className="mt-1 truncate font-semibold text-brand">{inr(journey.amount)}</dd>
                  </div>
                  <div className="min-w-0 rounded-md bg-surface px-1.5 py-2.5">
                    <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted sm:text-[10px]">
                      {t(lang, "runningTotal")}
                    </dt>
                    <dd className="mt-1 truncate font-semibold">
                      {km(journeys.slice(0, index + 1).reduce((sum, leg) => sum + leg.distanceKm, 0))}
                    </dd>
                  </div>
                </dl>

                {journey.distanceUpdated && (
                  <p className="mt-2 text-xs font-medium text-emerald-600">Updated distance</p>
                )}

                {uploadsEnabled && (
                  <div className="mt-2">
                    <JourneyBill
                      journeyId={journey.id}
                      employeeId={employeeId}
                      billPath={journey.billPath}
                      billName={journey.billName}
                      billType={journey.billType}
                      uploadsEnabled={uploadsEnabled}
                      lang={lang}
                    />
                  </div>
                )}
                <DistanceCorrection
                  journeyId={journey.id}
                  recordedKm={journey.distanceKm}
                  correction={journey.distanceCorrection}
                  lang={lang}
                />
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg px-3 py-2.5 text-sm tabular-nums">
            <span className="text-muted">{t(lang, "totalConveyanceLabel")}</span>
            <span className="font-medium">{km(totalKm)} · {inr(conveyanceTotal)}</span>
          </div>
        </>
      )}

      {miscExpenses.length > 0 && (
        <>
          <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {t(lang, "miscellaneousLabel")}
          </div>
          <ul className="space-y-2">
            {miscExpenses.map((expense) => (
              <li key={expense.id} className="flex items-start justify-between gap-3 rounded-md bg-bg px-3 py-2.5 text-sm">
                <span className="min-w-0 break-words">
                  {miscCategoryLabel(expense)}{expense.description ? ` · ${expense.description}` : ""}
                </span>
                <span className="shrink-0 pl-3 tabular-nums">{inr(expense.amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex items-center justify-between text-sm tabular-nums">
            <span className="text-muted">{t(lang, "totalMiscLabel")}</span>
            <span className="font-medium">{inr(miscellaneousTotal)}</span>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm font-semibold tabular-nums">
        <span>{t(lang, "grandTotal")}</span>
        <span>{inr(conveyanceTotal + miscellaneousTotal)}</span>
      </div>
    </div>
  );
}

function monthLabel(value: string, lang: "en" | "hi"): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Month-by-month totals complement the detailed current-day card above. */
async function PersonalSummary() {
  const currentMonth = monthKey();
  const [employeeId, lang] = await Promise.all([getActiveEmployeeId(), getLanguage()]);

  if (!employeeId) {
    return <Empty>{t(lang, "selectNameToSeeMonthlySummary")}</Empty>;
  }

  interface MonthTotal {
    month: string;
    distanceKm: number;
    conveyance: number;
    miscellaneous: number;
  }

  // Aggregate in Postgres so the page receives one row per month instead of
  // downloading every trip and expense the employee has ever recorded.
  const [journeyMonths, expenseMonths] = await Promise.all([
    prisma.$queryRaw<Array<{ month: string; distanceKm: number; conveyance: number }>>`
      SELECT LEFT("workDate", 7) AS "month",
             COALESCE(SUM("distanceKm"), 0)::float8 AS "distanceKm",
             COALESCE(SUM("amount"), 0)::float8 AS "conveyance"
      FROM "Journey"
      WHERE "employeeId" = ${employeeId} AND "workDate" <= ${`${currentMonth}-31`}
      GROUP BY LEFT("workDate", 7)
    `,
    prisma.$queryRaw<Array<{ month: string; miscellaneous: number }>>`
      SELECT LEFT("workDate", 7) AS "month",
             COALESCE(SUM("amount"), 0)::float8 AS "miscellaneous"
      FROM "MiscellaneousExpense"
      WHERE "employeeId" = ${employeeId} AND "workDate" <= ${`${currentMonth}-31`}
      GROUP BY LEFT("workDate", 7)
    `,
  ]);

  const totals = new Map<string, MonthTotal>();
  const ensure = (month: string): MonthTotal => {
    let total = totals.get(month);
    if (!total) {
      total = { month, distanceKm: 0, conveyance: 0, miscellaneous: 0 };
      totals.set(month, total);
    }
    return total;
  };

  for (const journey of journeyMonths) {
    const total = ensure(journey.month);
    total.distanceKm = journey.distanceKm;
    total.conveyance = journey.conveyance;
  }
  for (const expense of expenseMonths) {
    ensure(expense.month).miscellaneous = expense.miscellaneous;
  }

  // Include empty gaps so the list is a complete month-by-month history from
  // the employee's first record through the current month.
  const firstMonth = [...totals.keys()].sort()[0] ?? currentMonth;
  let cursor = firstMonth;
  while (cursor <= currentMonth) {
    ensure(cursor);
    const [year, month] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    cursor = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const months = [...totals.values()].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <div className="space-y-3">
      {months.map((total) => (
        <div key={total.month} className="rounded-lg border p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="font-semibold">{monthLabel(total.month, lang)}</span>
            {total.month === currentMonth && (
              <span className="badge bg-brand/10 text-brand">{t(lang, "currentMonthLabel")}</span>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-bg px-2 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t(lang, "distance")}
              </dt>
              <dd className="mt-1 font-semibold tabular-nums">{km(total.distanceKm)}</dd>
            </div>
            <div className="rounded-md bg-bg px-2 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t(lang, "conveyanceAmount")}
              </dt>
              <dd className="mt-1 font-semibold tabular-nums text-brand">
                {inr(total.conveyance)}
              </dd>
            </div>
            <div className="rounded-md bg-bg px-2 py-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t(lang, "miscellaneousLabel")}
              </dt>
              <dd className="mt-1 font-semibold tabular-nums">{inr(total.miscellaneous)}</dd>
            </div>
          </dl>

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

      <Card>
        <div id="my-entries" className="mb-3 scroll-mt-4 [&>h2]:mb-0">
          <SectionTitle>{t(lang, "myMonthlySummary")}</SectionTitle>
        </div>
        <Suspense fallback={<SummarySkeleton />}>
          <PersonalSummary />
        </Suspense>
      </Card>
    </div>
  );
}
