"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Check, X, Search, UserPlus, Power, MapPin } from "lucide-react";
import { createEmployee, setEmployeeStatus, setEmployeeOrigin } from "@/app/actions/roster";
import { Card, SectionTitle, Empty } from "@/components/ui";
import { VEHICLE_TYPES, VEHICLE_LABEL, type VehicleType } from "@/lib/enums";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export interface StaffRow {
  id: string;
  employeeCode: string;
  name: string;
  designation: string;
  department: string;
  vehicleType: string;
  status: string;
  /** null = the default (head office). Otherwise the site this person's day starts from. */
  defaultOriginSiteId: string | null;
}

export interface StartingPointOption {
  id: string;
  name: string;
  isOffice: boolean;
}

/** Suggestions drawn from the existing roster, so entries stay consistent. */
export interface RosterHints {
  designations: string[];
  departments: string[];
  /** Most common values on the roster — what a new joiner most likely is. */
  defaultDesignation: string;
  defaultDepartment: string;
}

export function StaffManager({
  staff, hints, startingPoints,
}: {
  staff: StaffRow[];
  hints: RosterHints;
  /** Sites eligible as a personal day-start — head office plus anything flagged as such. */
  startingPoints: StartingPointOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const headOffice = startingPoints.find((s) => s.isOffice);
  /** Only worth showing the picker once there is a real alternative to Head Office. */
  const hasAlternativeOrigin = startingPoints.length > 1;

  // New-employee form
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState(hints.defaultDesignation || "Field Staff");
  const [department, setDepartment] = useState(hints.defaultDepartment || "Operations");
  const [vehicleType, setVehicleType] = useState<VehicleType>("BIKE");
  const [phone, setPhone] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) =>
      `${s.name} ${s.employeeCode} ${s.designation} ${s.department}`.toLowerCase().includes(q));
  }, [staff, query]);

  const activeCount = staff.filter((s) => s.status === "ACTIVE").length;

  function reset() {
    setName(""); setPhone("");
    setDesignation(hints.defaultDesignation || "Field Staff");
    setDepartment(hints.defaultDepartment || "Operations");
    setVehicleType("BIKE");
  }

  function submit() {
    if (pending) return;
    setError(""); setAdded("");
    if (name.trim().length < 2) { setError("Enter the person's name."); return; }
    start(async () => {
      try {
        const r = await createEmployee({ name, designation, department, vehicleType, phone });
        if (!r.ok) { setError(r.error); return; }
        setAdded(`${name.trim()} added as ${r.data.employeeCode}.`);
        reset();
        setAdding(false);
        router.refresh();
      } catch (e) {
        setError(errorMessage(e));
      }
    });
  }

  function toggle(row: StaffRow) {
    if (pending) return;
    const activating = row.status !== "ACTIVE";
    if (!activating && !confirm(`Remove ${row.name} from the list people can select? Their past trips are kept.`)) return;
    setError(""); setAdded(""); setBusyId(row.id);
    start(async () => {
      try {
        const r = await setEmployeeStatus(row.id, activating);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch (e) {
        setError(errorMessage(e));
      } finally { setBusyId(null); }
    });
  }

  /** `siteId` is "" for "back to the default (Head Office)". */
  function changeOrigin(row: StaffRow, siteId: string) {
    if (pending) return;
    setError(""); setAdded(""); setBusyId(row.id);
    start(async () => {
      try {
        const r = await setEmployeeOrigin(row.id, siteId || null);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch (e) {
        setError(errorMessage(e));
      } finally { setBusyId(null); }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Staff</SectionTitle>
        <span className="text-xs text-muted">{activeCount} active · {staff.length} total</span>
      </div>
      <p className="-mt-2 mb-3 text-xs text-muted">
        Anyone listed here appears in the &ldquo;Your Name&rdquo; picker. Removing someone hides them
        from the picker but keeps every trip they have already logged.
      </p>

      {added && (
        <p className="mb-3 rounded-md border border-green-500/30 bg-green-500/10 p-2.5 text-sm text-green-600">{added}</p>
      )}
      {error && (
        <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-600">{error}</p>
      )}

      {!adding ? (
        <button type="button" onClick={() => { setAdding(true); setError(""); setAdded(""); }} className="btn-ghost text-sm">
          <UserPlus className="h-4 w-4" /> Add Staff
        </button>
      ) : (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plus className="h-4 w-4 text-brand" /> New staff member
          </div>

          <div>
            <label className="label" htmlFor="staff-name">Full Name</label>
            <input id="staff-name" className="input" value={name} autoFocus
              placeholder="e.g. Gayatri"
              onChange={(e) => { setName(e.target.value); setError(""); }} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="staff-desig">Designation</label>
              <input id="staff-desig" className="input" list="desig-options" value={designation}
                onChange={(e) => setDesignation(e.target.value)} />
              <datalist id="desig-options">
                {hints.designations.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>
            <div>
              <label className="label" htmlFor="staff-dept">Department</label>
              <input id="staff-dept" className="input" list="dept-options" value={department}
                onChange={(e) => setDepartment(e.target.value)} />
              <datalist id="dept-options">
                {hints.departments.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>
          </div>

          <div>
            <label className="label">Usual Vehicle — sets the per-km rate</label>
            <div className="flex flex-wrap gap-2">
              {VEHICLE_TYPES.map((v) => (
                <button type="button" key={v} onClick={() => setVehicleType(v)}
                  aria-pressed={vehicleType === v}
                  className={cn("rounded-md border px-3 py-1.5 text-sm transition",
                    vehicleType === v ? "border-brand bg-brand/10 text-brand" : "hover:bg-bg")}>
                  {VEHICLE_LABEL[v]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="staff-phone">Phone — optional</label>
            <input id="staff-phone" className="input" inputMode="tel" value={phone}
              placeholder="Optional" onChange={(e) => setPhone(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={pending} className="btn-primary flex-1 text-sm">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {pending ? "Adding…" : "Add Staff"}
            </button>
            <button type="button" onClick={() => { setAdding(false); reset(); setError(""); }} className="btn-ghost text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing roster */}
      <div className="mt-4">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search staff…" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search staff" />
        </div>

        {shown.length === 0 ? (
          <Empty>No staff match that search.</Empty>
        ) : (
          <ul className="max-h-96 space-y-1.5 overflow-y-auto">
            {shown.map((s) => (
              <li key={s.id}
                className={cn("rounded-md border p-2.5 text-sm", s.status !== "ACTIVE" && "opacity-60")}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      <span className="badge bg-bg text-[10px] text-muted">{s.employeeCode}</span>
                      {s.status !== "ACTIVE" && (
                        <span className="badge border-gray-500/20 bg-gray-500/10 text-[10px] text-gray-500">inactive</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {s.designation} · {s.department} · {VEHICLE_LABEL[s.vehicleType as VehicleType] ?? s.vehicleType}
                    </span>
                  </span>
                  <button type="button" onClick={() => toggle(s)} disabled={pending}
                    title={s.status === "ACTIVE" ? "Remove from picker" : "Restore to picker"}
                    className={cn("shrink-0 rounded p-1.5 transition disabled:opacity-50",
                      s.status === "ACTIVE" ? "text-muted hover:text-red-600" : "text-muted hover:text-green-600")}
                    aria-label={s.status === "ACTIVE" ? `Deactivate ${s.name}` : `Reactivate ${s.name}`}>
                    {busyId === s.id ? <Loader2 className="h-4 w-4 animate-spin" />
                      : s.status === "ACTIVE" ? <X className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  </button>
                </div>

                {hasAlternativeOrigin && (
                  <label className="mt-2 flex items-center gap-2 border-t pt-2 text-xs text-muted">
                    <MapPin className="h-3 w-3 shrink-0" /> Starts each day from
                    <select
                      className="input h-7 flex-1 py-0 text-xs"
                      value={s.defaultOriginSiteId ?? ""}
                      disabled={busyId === s.id}
                      onChange={(e) => changeOrigin(s, e.target.value)}
                    >
                      <option value="">{headOffice?.name ?? "Head Office"} (default)</option>
                      {startingPoints.filter((p) => !p.isOffice).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
