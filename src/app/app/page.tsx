import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getActiveEmployees, getActiveSites, getHeadOffice } from "@/lib/masterData";
import { getActiveEmployeeId } from "@/app/actions/session";
import { getLanguage } from "@/app/actions/language";
import { t } from "@/lib/i18n";
import { monthKey, inr, km } from "@/lib/utils";
import { isUploadConfigured } from "@/lib/storage";
import { Card, SectionTitle, Empty, SummarySkeleton } from "@/components/ui";
import { CheckinForm } from "./CheckinForm";
import { MiscExpenses } from "./MiscExpenses";

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

function monthLabel(value: string, lang: "en" | "hi"): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/**
 * Show only monthly aggregates to employees. Individual routes, dates,
 * expenses, bills, and correction records remain in the admin area.
 */
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
