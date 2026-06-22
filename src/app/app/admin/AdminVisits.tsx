"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteVisit } from "@/app/actions/visit";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { inr, km } from "@/lib/utils";

interface Visit {
  id: string;
  employee: string;
  site: string;
  date: string;
  distanceKm: number;
  amount: number;
  mode: string;
}

function modeLabel(m: string) {
  return m === "BUSMETRO" ? "Bus/Metro" : m === "CAR" ? "Car" : m === "BIKE" ? "Bike" : m;
}

export function AdminVisits({ visits, monthAmount }: { visits: Visit[]; monthAmount: number }) {
  const [pending, start] = useTransition();

  function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    start(() => deleteVisit(id).then(() => {}));
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Entries</SectionTitle>
        <span className="text-sm font-medium tabular-nums">Total: {inr(monthAmount)}</span>
      </div>
      {visits.length === 0 ? (
        <Empty>No entries this month.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Employee</th>
                <th className="py-2 pr-3 font-medium">Site</th>
                <th className="py-2 pr-3 font-medium">Mode</th>
                <th className="py-2 pr-3 font-medium text-right">Km</th>
                <th className="py-2 pr-3 font-medium text-right">Amount</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visits.map((v) => (
                <tr key={v.id}>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{v.date}</td>
                  <td className="py-2 pr-3 font-medium">{v.employee}</td>
                  <td className="py-2 pr-3">{v.site}</td>
                  <td className="py-2 pr-3">{modeLabel(v.mode)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{km(v.distanceKm)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(v.amount)}</td>
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
