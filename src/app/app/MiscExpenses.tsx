"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { Loader2, Plus, Pencil, Trash2, Check, X, Receipt, Paperclip } from "lucide-react";
import { addMiscExpense, updateMiscExpense, deleteMiscExpense, listMiscExpenses } from "@/app/actions/misc";
import { MISC_CATEGORIES, MISC_CATEGORY_LABEL, type MiscCategory } from "@/lib/enums";
import { inr, todayKey, cn } from "@/lib/utils";
import { BillUpload, type BillMetaValue } from "@/components/BillUpload";
import { BillActions } from "@/components/BillActions";

interface Employee { id: string; name: string; designation: string }
interface Expense {
  id: string; workDate: string; category: string; customCategory: string | null;
  amount: number; description: string | null; notes: string | null;
  billPath: string | null; billName: string | null; billType: string | null;
}

function catLabel(e: Expense) {
  return e.category === "OTHER" ? (e.customCategory || "Other") : MISC_CATEGORY_LABEL[e.category as MiscCategory] ?? e.category;
}

export function MiscExpenses({ employees, uploadsEnabled }: { employees: Employee[]; uploadsEnabled: boolean }) {
  const [employeeId, setEmployeeId] = useState("");
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback((empId: string) => {
    if (!empId) { setItems([]); return; }
    setLoading(true);
    listMiscExpenses(empId).then((r) => setItems(r as Expense[])).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(employeeId); }, [employeeId, refresh]);

  const total = items.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="misc-emp">Employee</label>
        <select id="misc-emp" className="input" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setShowForm(false); setEditing(null); }}>
          <option value="">— Select your name —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.designation}</option>)}
        </select>
      </div>

      {employeeId && (
        <>
          {!showForm && !editing && (
            <button type="button" onClick={() => setShowForm(true)} className="btn-ghost text-sm">
              <Plus className="h-4 w-4" /> Add Expense
            </button>
          )}

          {(showForm || editing) && (
            <ExpenseForm
              employeeId={employeeId}
              expense={editing}
              uploadsEnabled={uploadsEnabled}
              onDone={() => { setShowForm(false); setEditing(null); refresh(employeeId); }}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">No miscellaneous expenses recorded.</p>
          ) : (
            <div className="space-y-2">
              {items.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{catLabel(e)}</span>
                      <span className="text-xs text-muted tabular-nums">{e.workDate}</span>
                      {e.billPath && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-3 w-3 text-green-600" />
                          <BillActions entity="misc" id={e.id} name={e.billName} type={e.billType} compact />
                        </span>
                      )}
                    </div>
                    {e.description && <p className="text-muted truncate">{e.description}</p>}
                    {e.notes && <p className="text-xs text-muted truncate">{e.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-medium tabular-nums">{inr(e.amount)}</span>
                    <button type="button" onClick={() => { setEditing(e); setShowForm(false); }} className="text-muted hover:text-fg" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                    <DeleteButton id={e.id} employeeId={employeeId} onDone={() => refresh(employeeId)} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between border-t pt-2 text-sm font-medium tabular-nums">
                <span>Miscellaneous Total</span><span>{inr(total)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeleteButton({ id, employeeId, onDone }: { id: string; employeeId: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <span className="flex items-center gap-1">
        <button type="button" disabled={pending} onClick={() => start(async () => { await deleteMiscExpense(id, employeeId); onDone(); })} className="text-red-600" aria-label="Confirm delete"><Check className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setConfirm(false)} className="text-muted" aria-label="Cancel"><X className="h-3.5 w-3.5" /></button>
      </span>
    );
  }
  return <button type="button" onClick={() => setConfirm(true)} className="text-muted hover:text-red-600" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>;
}

function ExpenseForm({
  employeeId, expense, uploadsEnabled, onDone, onCancel,
}: {
  employeeId: string;
  expense: Expense | null;
  uploadsEnabled: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<MiscCategory>((expense?.category as MiscCategory) ?? "PARKING");
  const [customCategory, setCustomCategory] = useState(expense?.customCategory ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [workDate, setWorkDate] = useState(expense?.workDate ?? todayKey());
  const [description, setDescription] = useState(expense?.description ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [bill, setBill] = useState<BillMetaValue | null>(null); // newly uploaded
  const [removeExisting, setRemoveExisting] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const hasExistingBill = !!expense?.billPath && !removeExisting;

  function submit() {
    setError("");
    if (!(parseFloat(amount) > 0)) { setError("Amount must be greater than zero."); return; }
    if (category === "OTHER" && !customCategory.trim()) { setError("Enter a custom category for “Other”."); return; }

    const payload = {
      employeeId,
      category,
      customCategory: category === "OTHER" ? customCategory.trim() : undefined,
      amount: parseFloat(amount),
      description: description || undefined,
      notes: notes || undefined,
      workDate,
      bill: bill ?? undefined,
      removeBill: expense ? (removeExisting && !bill) : undefined,
    };

    start(async () => {
      try {
        if (expense) await updateMiscExpense(expense.id, payload);
        else await addMiscExpense(payload);
        onDone();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Receipt className="h-4 w-4 text-brand" /> {expense ? "Edit expense" : "New expense"}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Category</label>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as MiscCategory)}>
            {MISC_CATEGORIES.map((c) => <option key={c} value={c}>{MISC_CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </div>
      </div>
      {category === "OTHER" && (
        <div>
          <label className="label">Custom Category</label>
          <input className="input" placeholder="Enter category" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} />
        </div>
      )}
      <div>
        <label className="label">Amount (₹)</label>
        <input type="number" min="0" step="0.01" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <label className="label">Notes</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      {/* Bill / attachment */}
      <div>
        <label className="label">Bill / Attachment</label>
        {!uploadsEnabled ? (
          <p className="text-xs text-muted">Bill attachments are currently disabled. The expense will still be saved.</p>
        ) : hasExistingBill && !replacing && !bill ? (
          <div className="flex items-center justify-between gap-2 rounded-md border p-2">
            <span className="inline-flex items-center gap-1.5 min-w-0 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <span className="truncate">{expense?.billName ?? "Bill attached"}</span>
            </span>
            <span className="flex items-center gap-3 shrink-0">
              <BillActions entity="misc" id={expense!.id} name={expense?.billName} type={expense?.billType} compact />
              <button type="button" onClick={() => setReplacing(true)} className="text-xs text-brand">Replace</button>
              <button type="button" onClick={() => { setRemoveExisting(true); setReplacing(false); }} className="text-xs text-red-600">Remove</button>
            </span>
          </div>
        ) : (
          <>
            <BillUpload employeeId={employeeId} onChange={(m) => setBill(m)} />
            {(replacing || removeExisting) && expense?.billPath && (
              <button type="button" onClick={() => { setReplacing(false); setRemoveExisting(false); setBill(null); }} className="mt-1 text-xs text-muted">Keep existing bill instead</button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={pending} className="btn-primary text-sm flex-1">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {expense ? "Save Changes" : "Add Expense"}
        </button>
        <button type="button" onClick={onCancel} className={cn("btn-ghost text-sm")}>Cancel</button>
      </div>
    </div>
  );
}
