"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteVisit } from "@/app/actions/visit";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { inr, km } from "@/lib/utils";
import { LOCATION_TYPES, LOCATION_TYPE_LABEL, type LocationType } from "@/lib/enums";
import { BillActions } from "@/components/BillActions";

interface Visit {
  id: string;
  employee: string;
  site: string;
  date: string;
  distanceKm: number;
  amount: number;
  mode: string;
  locationType: string;
  billPath: string | null;
  billName: string | null;
  billType: string | null;
}

function modeLabel(m: string) {
  return m === "BUSMETRO" ? "Bus/Metro" : m === "CAR" ? "Car" : m === "BIKE" ? "Bike" : m;
}

export function AdminVisits({ visits, monthAmount }: { visits: Visit[]; monthAmount: number }) {
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"ALL" | LocationType>("ALL");

  function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    start(() => deleteVisit(id).then(() => {}));
  }

  const shown = filter === "ALL" ? visits : visits.filter((v) => v.locationType === filter);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <SectionTitle>Entries</SectionTitle>
        <div className="flex items-center gap-2">
          <select className="input h-8 py-0 text-xs w-auto" value={filter} onChange={(e) => setFilter(e.target.value as "ALL" | LocationType)}>
            <option value="ALL">All location types</option>
            {LOCATION_TYPES.map((t) => <option key={t} value={t}>{LOCATION_TYPE_LABEL[t]}</option>)}
          </select>
          <span className="text-sm font-medium tabular-nums">Total: {inr(monthAmount)}</span>
        </div>
      </div>
      {shown.length === 0 ? (
        <Empty>No entries this month.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Employee</th>
                <th className="py-2 pr-3 font-medium">Destination</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Mode</th>
                <th className="py-2 pr-3 font-medium text-right">Km</th>
                <th className="py-2 pr-3 font-medium text-right">Amount</th>
                <th className="py-2 pr-3 font-medium">Bill</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{v.date}</td>
                  <td className="py-2 pr-3 font-medium">{v.employee}</td>
                  <td className="py-2 pr-3">{v.site}</td>
                  <td className="py-2 pr-3 text-xs text-muted whitespace-nowrap">{LOCATION_TYPE_LABEL[v.locationType as LocationType] ?? v.locationType}</td>
                  <td className="py-2 pr-3">{modeLabel(v.mode)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{km(v.distanceKm)}</td>
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
                      className="text-muted hover:text-red-600"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-4 w-4" />
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
