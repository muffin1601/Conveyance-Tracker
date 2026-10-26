"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { saveStaffEntry } from "@/app/actions/settings";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { LOCATION_TYPES, LOCATION_TYPE_LABEL, VEHICLE_TYPES, VEHICLE_LABEL, type LocationType, type VehicleType } from "@/lib/enums";
import { errorMessage } from "@/lib/errors";
import { fmtTime, km } from "@/lib/utils";

type Staff = { id: string; name: string; vehicleType?: string };
type Entry = { id: string; employeeId: string; employee: string; date: string; destination: string; address: string; loginAt: string; locationType: string; mode: string; distanceKm: number };

function localDateTime(date: string, iso?: string) {
  if (iso) {
    const value = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  return `${date}T09:00`;
}

export function StaffEntriesManager({ staff, entries }: { staff: Staff[]; entries: Entry[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const [form, setForm] = useState({ employeeId: "", workDate: today, destination: "", address: "", locationType: "CUSTOM", mode: "BIKE", distanceKm: "", loginAt: `${today}T09:00` });

  function beginEdit(entry: Entry) {
    setEditing(entry); setSuccess(""); setError("");
    setForm({ employeeId: entry.employeeId, workDate: entry.date, destination: entry.destination, address: entry.address, locationType: entry.locationType, mode: VEHICLE_TYPES.includes(entry.mode as VehicleType) ? entry.mode : "BIKE", distanceKm: String(entry.distanceKm), loginAt: localDateTime(entry.date, entry.loginAt) });
  }
  function reset() {
    const date = new Date().toLocaleDateString("en-CA");
    setEditing(null); setForm({ employeeId: "", workDate: date, destination: "", address: "", locationType: "CUSTOM", mode: "BIKE", distanceKm: "", loginAt: `${date}T09:00` });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSuccess("");
    start(async () => {
      try {
        await saveStaffEntry({ ...form, id: editing?.id, distanceKm: Number(form.distanceKm), loginAt: form.loginAt ? new Date(form.loginAt).toISOString() : "" });
        setSuccess(editing ? "Entry updated." : "Entry added."); reset(); router.refresh();
      } catch (err) { setError(errorMessage(err)); }
    });
  }

  return <div className="space-y-4">
    <Card>
      <SectionTitle>{editing ? "Edit conveyance entry" : "Add conveyance entry"}</SectionTitle>
      <p className="mb-4 text-sm text-muted">Add or correct the entries shown in Admin → Conveyance. The amount is recalculated using the current rate.</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="label">Employee<select className="input mt-1" required value={form.employeeId} onChange={e => { const selected = staff.find(s => s.id === e.target.value); setForm({ ...form, employeeId: e.target.value, mode: selected?.vehicleType && VEHICLE_TYPES.includes(selected.vehicleType as VehicleType) ? selected.vehicleType : form.mode }); }}><option value="">Select employee</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="label">Date<input className="input mt-1" required type="date" value={form.workDate} onChange={e => setForm({ ...form, workDate: e.target.value })} /></label>
        <label className="label">Login time<input className="input mt-1" type="datetime-local" value={form.loginAt} onChange={e => setForm({ ...form, loginAt: e.target.value })} /></label>
        <label className="label">Destination<input className="input mt-1" required maxLength={200} value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} /></label>
        <label className="label">Address <span className="font-normal text-muted">(optional)</span><input className="input mt-1" maxLength={300} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label>
        <label className="label">Location type<select className="input mt-1" value={form.locationType} onChange={e => setForm({ ...form, locationType: e.target.value })}>{LOCATION_TYPES.map(type => <option key={type} value={type}>{LOCATION_TYPE_LABEL[type as LocationType]}</option>)}</select></label>
        <label className="label">Mode<select className="input mt-1" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}>{VEHICLE_TYPES.map(type => <option key={type} value={type}>{VEHICLE_LABEL[type as VehicleType]}</option>)}</select></label>
        <label className="label">Distance (km)<input className="input mt-1" required type="number" min="0.01" max="2000" step="0.01" value={form.distanceKm} onChange={e => setForm({ ...form, distanceKm: e.target.value })} /></label>
        <div className="flex items-end gap-2"><button disabled={pending || staff.length === 0} className="btn-primary" type="submit">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editing ? "Save changes" : "Add entry"}</button>{editing && <button type="button" className="btn-ghost" onClick={reset}><X className="h-4 w-4" />Cancel</button>}</div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}{success && <p role="status" className="mt-3 text-sm text-emerald-700">{success}</p>}
    </Card>
    <Card>
      <SectionTitle>Recent conveyance entries</SectionTitle><p className="mb-3 text-xs text-muted">Showing up to 200 most recent entries.</p>
      {entries.length === 0 ? <Empty>No conveyance entries yet.</Empty> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-muted"><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Employee</th><th className="py-2 pr-3">Destination</th><th className="py-2 pr-3">Login time</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Mode</th><th className="py-2 pr-3 text-right">Km</th><th className="py-2 pr-3 text-right">Action</th></tr></thead><tbody className="divide-y">{entries.map(entry => <tr key={entry.id}><td className="py-2 pr-3 whitespace-nowrap">{entry.date}</td><td className="py-2 pr-3">{entry.employee}</td><td className="py-2 pr-3">{entry.destination}{entry.address && <span className="block max-w-sm truncate text-xs text-muted">{entry.address}</span>}</td><td className="py-2 pr-3 whitespace-nowrap">{entry.loginAt ? fmtTime(entry.loginAt) : "—"}</td><td className="py-2 pr-3 text-xs text-muted">{LOCATION_TYPE_LABEL[entry.locationType as LocationType] ?? entry.locationType}</td><td className="py-2 pr-3">{VEHICLE_LABEL[entry.mode as VehicleType] ?? entry.mode}</td><td className="py-2 pr-3 text-right">{km(entry.distanceKm)}</td><td className="py-2 pr-3 text-right"><button type="button" className="btn-ghost px-2 py-1" onClick={() => beginEdit(entry)}><Pencil className="h-3.5 w-3.5" />Edit</button></td></tr>)}</tbody></table></div>}
    </Card>
  </div>;
}
