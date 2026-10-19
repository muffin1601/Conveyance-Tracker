"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { adminDeleteMiscExpense } from "@/app/actions/misc";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { inr } from "@/lib/utils";
import { MISC_CATEGORY_LABEL, type MiscCategory } from "@/lib/enums";
import { BillActions } from "@/components/BillActions";
import { errorMessage } from "@/lib/errors";

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
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function remove(id: string) {
    if (pending || !confirm("Delete this expense? This cannot be undone.")) return;
    setError("");
    setDeletingId(id);
    start(async () => {
      try {
        await adminDeleteMiscExpense(id);
        setRows((r) => r.filter((x) => x.id !== id));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle>Miscellaneous Expenses</SectionTitle>
        <span className="text-sm font-medium tabular-nums">Total: {inr(total)}</span>
      </div>
      <p className="-mt-2 mb-3 text-xs text-muted">Review non-travel costs separately from conveyance before exporting or deleting.</p>
      {error && <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-600" role="alert">{error}</p>}
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
                    <button onClick={() => remove(m.id)} disabled={pending} className="text-muted hover:text-red-600 disabled:opacity-50" aria-label={`Delete ${catLabel(m)} expense`}>
                      {deletingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
