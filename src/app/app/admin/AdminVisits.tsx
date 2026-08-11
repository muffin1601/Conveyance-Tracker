"use client";

import { useMemo, useState, useTransition } from "react";

import { deleteVisit } from "@/app/actions/visit";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { cn, inr, km } from "@/lib/utils";
import { LOCATION_TYPES, LOCATION_TYPE_LABEL, type LocationType } from "@/lib/enums";
import { distanceSourceLabel, isRoadDistance } from "@/lib/routing/types";
import { BillActions } from "@/components/BillActions";
import { errorMessage } from "@/lib/errors";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search, Trash2 } from "lucide-react";

interface Visit {
  id: string;
  employee: string;
  site: string;
  /** Full street address of the destination, when one was recorded. */
  address: string | null;
  date: string;
  distanceKm: number;
  amount: number;
  mode: string;
  /** How the distance was obtained — OSRM/CACHE/GOOGLE/HAVERSINE/MANUAL. */
  distanceSource: string;
  locationType: string;
  billPath: string | null;
  billName: string | null;
  billType: string | null;
}

type SortKey = "date" | "employee" | "distanceKm" | "amount";

/**
 * A column header that sorts. Clicking the active column flips direction;
 * clicking another column starts it in the direction that column is usually
 * wanted in — newest dates and biggest amounts first, names A–Z.
 */
function SortableHeader({
  label, sortKey, sort, onSort, align = "left",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; ascending: boolean };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn("py-2 pr-3 font-medium", align === "right" && "text-right")}
      // aria-sort belongs to the column header, not to the control inside it.
      aria-sort={active ? (sort.ascending ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-fg",
          active && "text-fg font-semibold",
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active
          ? (sort.ascending ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
          : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

function modeLabel(m: string) {
  return m === "BUSMETRO" ? "Bus/Metro" : m === "CAR" ? "Car" : m === "BIKE" ? "Bike" : m;
}

export function AdminVisits({
  visits, monthAmount, shownOf,
}: {
  visits: Visit[];
  monthAmount: number;
  /** How many of the period's entries this table is showing. */
  shownOf: { shown: number; total: number };
}) {
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"ALL" | LocationType>("ALL");
  const [query, setQuery] = useState("");
  /** Newest first is what a monthly review starts from. */
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "date", ascending: false });
  const [error, setError] = useState("");
  /** The row being deleted — so only its button shows a spinner. */
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function remove(id: string) {
    if (pending) return; // a second click would fire a duplicate delete
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setError("");
    setDeletingId(id);
    start(async () => {
      try {
        const r = await deleteVisit(id);
        // The action reports expected failures in its result; a thrown error
        // would be redacted by Next in production and never reach the user.
        if (!r.ok) setError(r.error);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setDeletingId(null);
      }
    });
  }

  /**
   * Filter, then search, then sort — in that order, so the sort applies to
   * what the manager is actually looking at.
   *
   * All three run on the page already in memory. That is the honest scope:
   * the table is capped at the most recent 300 entries and the banner above
   * says so, so this finds a row inside the current view rather than
   * pretending to search the whole month. For a full-period search the export
   * is still the right tool.
   */
  /** Same column flips direction; a new column starts in its natural order. */
  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, ascending: !current.ascending }
        : { key, ascending: key === "employee" },
    );
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = visits.filter((v) => {
      if (filter !== "ALL" && v.locationType !== filter) return false;
      if (!needle) return true;
      return (
        v.employee.toLowerCase().includes(needle) ||
        v.site.toLowerCase().includes(needle) ||
        (v.address?.toLowerCase().includes(needle) ?? false)
      );
    });

    const direction = sort.ascending ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case "employee":
          return a.employee.localeCompare(b.employee) * direction;
        case "distanceKm":
          return (a.distanceKm - b.distanceKm) * direction;
        case "amount":
          return (a.amount - b.amount) * direction;
        case "date":
        default:
          // Same-day rows keep a stable, meaningful order by falling back to
          // the employee rather than whatever order the query returned.
          return (a.date.localeCompare(b.date) || a.employee.localeCompare(b.employee)) * direction;
      }
    });
  }, [visits, filter, query, sort]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <SectionTitle>Entries</SectionTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="search"
              className="input h-8 w-44 py-0 pl-7 text-xs"
              placeholder="Search name or place…"
              aria-label="Search entries by employee, destination or address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="input h-8 py-0 text-xs w-auto" value={filter} onChange={(e) => setFilter(e.target.value as "ALL" | LocationType)}>
            <option value="ALL">All location types</option>
            {LOCATION_TYPES.map((t) => <option key={t} value={t}>{LOCATION_TYPE_LABEL[t]}</option>)}
          </select>
          <span className="text-sm font-medium tabular-nums">Total: {inr(monthAmount)}</span>
        </div>
      </div>
      {shownOf.total > shownOf.shown && (
        <p className="mb-3 rounded-md border bg-bg p-2.5 text-xs text-muted">
          Showing the {shownOf.shown} most recent of {shownOf.total} entries for this month. The
          totals above cover all {shownOf.total}. Use the export buttons for the complete list.
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-600">{error}</p>
      )}
      {shown.length === 0 ? (
        <Empty>No entries this month.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b">
                <SortableHeader label="Date" sortKey="date" sort={sort} onSort={toggleSort} />
                <SortableHeader label="Employee" sortKey="employee" sort={sort} onSort={toggleSort} />
                <th className="py-2 pr-3 font-medium">Destination</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Mode</th>
                <SortableHeader label="Km" sortKey="distanceKm" sort={sort} onSort={toggleSort} align="right" />
                <SortableHeader label="Amount" sortKey="amount" sort={sort} onSort={toggleSort} align="right" />
                <th className="py-2 pr-3 font-medium">Bill</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{v.date}</td>
                  <td className="py-2 pr-3 font-medium">{v.employee}</td>
                  <td className="py-2 pr-3">
                    <span>{v.site}</span>
                    {/* The street address sits under the short name rather than
                        in its own column: it is long, it is only sometimes
                        present, and the name is what the eye scans down. */}
                    {v.address && v.address !== v.site && (
                      <span className="block text-xs text-muted max-w-[26rem] truncate" title={v.address}>
                        {v.address}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted whitespace-nowrap">{LOCATION_TYPE_LABEL[v.locationType as LocationType] ?? v.locationType}</td>
                  <td className="py-2 pr-3">{modeLabel(v.mode)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {km(v.distanceKm)}
                    {/* Only the exceptions are called out. Marking every routed
                        row "Road distance" would be noise on a dense table;
                        what a reviewer needs to spot is the row that ISN'T. */}
                    {!isRoadDistance(v.distanceSource) && (
                      <span className="block text-[11px] font-normal text-amber-600">
                        {distanceSourceLabel(v.distanceSource)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(v.amount)}</td>
                  <td className="py-2 pr-3">
                    {v.billPath
                      ? <BillActions entity="conveyance" id={v.id} name={v.billName} type={v.billType} />
                      : <span className="text-muted text-xs">No</span>}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => remove(v.id)}
                      disabled={pending}
                      className="text-muted hover:text-red-600 disabled:opacity-50"
                      aria-label="Delete entry"
                    >
                      {deletingId === v.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
