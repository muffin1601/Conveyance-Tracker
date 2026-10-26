"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { saveStaffEntry } from "@/app/actions/settings";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { errorMessage } from "@/lib/errors";
import { km } from "@/lib/utils";

type Staff = { id: string; name: string };
type Entry = { id: string; employeeId: string; employee: string; date: string; from: string; to: string; mode: string; distanceKm: number };

export function StaffEntriesManager({ staff, entries }: { staff: Staff[]; entries: Entry[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({ employeeId: "", workDate: new Date().toLocaleDateString("en-CA"), fromName: "Head Office", toName: "", mode: "BIKE", distanceKm: "" });

  function beginEdit(entry: Entry) {
    setEditing(entry);
    setSuccess(""); setError("");
    setForm({ employeeId: entry.employeeId, workDate: entry.date, fromName: entry.from, toName: entry.to, mode: ["BIKE", "CAR", "BUSMETRO"].includes(entry.mode) ? entry.mode : "BIKE", distanceKm: String(entry.distanceKm) });
  }
  function reset() {
    setEditing(null);
    setForm({ employeeId: "", workDate: new Date().toLocaleDateString("en-CA"), fromName: "Head Office", toName: "", mode: "BIKE", distanceKm: "" });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSuccess("");
    start(async () => {
      try {
        await saveStaffEntry({ ...form, id: editing?.id, distanceKm: Number(form.distanceKm) });
        setSuccess(editing ? "Entry updated." : "Entry added.");
        reset(); router.refresh();
      } catch (err) { setError(errorMessage(err)); }
    });
  }

  return <div className="space-y-4">
    <Card>
      <SectionTitle>{editing ? "Edit staff entry" : "Add entry for staff"}</SectionTitle>
      <p className="mb-4 text-sm text-muted">Record or correct a conveyance trip for any staff member. The amount is calculated from the current rate.</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="label">Staff<select className="input mt-1" required value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })}><option value="">Select staff</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="label">Date<input className="input mt-1" required type="date" value={form.workDate} onChange={e => setForm({ ...form, workDate: e.target.value })} /></label>
        <label className="label">Travel mode<select className="input mt-1" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}><option value="BIKE">Bike</option><option value="CAR">Car</option><option value="BUSMETRO">Bus/Metro</option></select></label>
        <label className="label">From<input className="input mt-1" required maxLength={200} value={form.fromName} onChange={e => setForm({ ...form, fromName: e.target.value })} /></label>
        <label className="label">To<input className="input mt-1" required maxLength={200} value={form.toName} onChange={e => setForm({ ...form, toName: e.target.value })} /></label>
        <label className="label">Distance (km)<input className="input mt-1" required type="number" min="0.01" max="2000" step="0.01" value={form.distanceKm} onChange={e => setForm({ ...form, distanceKm: e.target.value })} /></label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <button disabled={pending || staff.length === 0} className="btn-primary" type="submit">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editing ? "Save changes" : "Add entry"}</button>
          {editing && <button type="button" className="btn-ghost" onClick={reset}><X className="h-4 w-4" />Cancel</button>}
          {staff.length === 0 && <span className="text-sm text-muted">Add active staff members first.</span>}
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p role="status" className="mt-3 text-sm text-emerald-700">{success}</p>}
    </Card>
    <Card>
      <SectionTitle>Recent staff entries</SectionTitle>
      <p className="mb-3 text-xs text-muted">Showing up to 200 most recent entries.</p>
      {entries.length === 0 ? <Empty>No conveyance entries yet.</Empty> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Staff</th><th className="py-2 pr-3">Route</th><th className="py-2 pr-3">Mode</th><th className="py-2 pr-3 text-right">Distance</th><th className="py-2 pr-3 text-right">Action</th></tr></thead><tbody className="divide-y">{entries.map(entry => <tr key={entry.id}><td className="py-2 pr-3 whitespace-nowrap">{entry.date}</td><td className="py-2 pr-3">{entry.employee}</td><td className="py-2 pr-3">{entry.from} → {entry.to}</td><td className="py-2 pr-3">{entry.mode}</td><td className="py-2 pr-3 text-right">{km(entry.distanceKm)}</td><td className="py-2 pr-3 text-right"><button type="button" className="btn-ghost px-2 py-1" onClick={() => beginEdit(entry)}><Pencil className="h-3.5 w-3.5" />Edit</button></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}
