"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { adminDeleteMiscExpense } from "@/app/actions/misc";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { inr } from "@/lib/utils";
import { MISC_CATEGORY_LABEL, type MiscCategory } from "@/lib/enums";
import { BillActions } from "@/components/BillActions";

interface MiscRow {
  id: string;
  employee: string;
  date: string;
  category: string;
  customCategory: string | null;
  amount: number;
  description: string | null;
  billPath: string | null;
  billName: string | null;
  billType: string | null;
}

function catLabel(m: MiscRow) {
  return m.category === "OTHER" ? (m.customCategory || "Other") : MISC_CATEGORY_LABEL[m.category as MiscCategory] ?? m.category;
}

export function AdminMisc({ items, total }: { items: MiscRow[]; total: number }) {
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(items);

  function remove(id: string) {
    if (!confirm("Delete this expense?")) return;
    start(async () => {
      await adminDeleteMiscExpense(id);
      setRows((r) => r.filter((x) => x.id !== id));
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Miscellaneous Expenses</SectionTitle>
        <span className="text-sm font-medium tabular-nums">Total: {inr(total)}</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No miscellaneous expenses this period.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Employee</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 pr-3 font-medium">Bill</th>
                <th className="py-2 pr-3 font-medium text-right">Amount</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{m.date}</td>
                  <td className="py-2 pr-3 font-medium">{m.employee}</td>
                  <td className="py-2 pr-3">{catLabel(m)}</td>
                  <td className="py-2 pr-3">{m.description || <span className="text-muted">—</span>}</td>
                  <td className="py-2 pr-3">
                    {m.billPath
                      ? <BillActions entity="misc" id={m.id} name={m.billName} type={m.billType} />
                      : <span className="text-muted text-xs">No</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(m.amount)}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => remove(m.id)} disabled={pending} className="text-muted hover:text-red-600" aria-label="Delete expense">
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
