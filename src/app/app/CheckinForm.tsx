"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Check, ArrowRight, MapPin, Bike, Car, TrainFront } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { logVisit, previewVisit } from "@/app/actions/visit";
import type { TravelMode } from "@/lib/travel";
import { cn, inr, km } from "@/lib/utils";

interface Employee {
  id: string;
  name: string;
  designation: string;
  department: string;
}
interface Site {
  id: string;
  name: string;
  city: string | null;
  address: string;
}

const MODES: { key: TravelMode; label: string; Icon: LucideIcon }[] = [
  { key: "BIKE", label: "Bike", Icon: Bike },
  { key: "CAR", label: "Car", Icon: Car },
  { key: "BUSMETRO", label: "Bus/Metro", Icon: TrainFront },
];

interface Preview {
  fromName: string;
  toName: string;
  km: number;
  amount: number;
  alreadyHere: boolean;
}

export function CheckinForm({
  employees,
  sites,
  rates,
  officeName,
  officeAddress,
}: {
  employees: Employee[];
  sites: Site[];
  rates: Record<TravelMode, number>;
  officeName: string;
  officeAddress: string;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [mode, setMode] = useState<TravelMode>("BIKE");
  const [fare, setFare] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pending, start] = useTransition();

  const site = sites.find((s) => s.id === siteId);
  const fareNum = parseFloat(fare);
  const useActual = mode === "BUSMETRO" && fareNum > 0;

  // Fetch an accurate, chained preview (source = the employee's last site that
  // day, or the office) whenever the inputs change.
  useEffect(() => {
    if (!employeeId || !siteId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    previewVisit({
      employeeId,
      siteId,
      mode,
      fareActual: useActual ? fareNum : undefined,
    })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, siteId, mode, useActual, fareNum]);

  function submit() {
    setMsg(null);
    if (!employeeId) return setMsg({ ok: false, text: "Select your name." });
    if (!siteId) return setMsg({ ok: false, text: "Select the site you are visiting." });
    start(async () => {
      try {
        const r = await logVisit({
          employeeId,
          siteId,
          mode,
          fareActual: useActual ? fareNum : undefined,
        });
        setMsg({ ok: true, text: `${r.from} → ${r.site} · ${km(r.km)} · ${inr(r.amount)} logged.` });
        setSiteId("");
        setFare("");
        setPreview(null);
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="label" htmlFor="emp">Your Name</label>
        <select id="emp" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">— Select your name —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.designation}
            </option>
          ))}
        </select>
      </div>

      {/* Starting point — auto-resolved, never picked by the user. */}
      {employeeId && (() => {
        const fromName = preview?.fromName ?? officeName;
        const atOffice = !preview || preview.fromName === officeName;
        return (
          <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand">
              <MapPin className="h-3.5 w-3.5" />
              Starting from
            </div>
            <div className="mt-1 font-semibold text-fg leading-tight">{fromName}</div>
            {atOffice && officeAddress && (
              <div className="mt-0.5 text-xs text-muted leading-snug">{officeAddress}</div>
            )}
          </div>
        );
      })()}

      <div>
        <label className="label" htmlFor="site">Site You Are Visiting</label>
        <select id="site" className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">— Select the site —</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}{s.city ? ` · ${s.city}` : ""}
            </option>
          ))}
        </select>
        {site && <p className="text-xs text-muted mt-1 truncate">{site.address}</p>}
      </div>

      <div>
        <label className="label">Mode of Transport</label>
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "rounded-lg border p-4 text-center transition",
                mode === m.key ? "border-brand bg-brand/10" : "hover:bg-bg",
              )}
            >
              <m.Icon className={cn("h-6 w-6 mx-auto", mode === m.key ? "text-brand" : "text-muted")} />
              <div className="mt-1.5 text-sm font-medium">{m.label}</div>
              <div className="text-xs text-muted">
                {m.key === "BUSMETRO" ? `₹${rates[m.key]}/km or actual` : `₹${rates[m.key]}/km`}
              </div>
            </button>
          ))}
        </div>
      </div>

      {mode === "BUSMETRO" && (
        <div>
          <label className="label" htmlFor="fare">Actual Fare (₹) — optional</label>
          <input
            id="fare"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            className="input"
            placeholder="Leave blank to auto-calculate by distance"
            value={fare}
            onChange={(e) => setFare(e.target.value)}
          />
          <p className="text-xs text-muted mt-1">Enter your actual bus/metro ticket fare, or leave blank to estimate by distance.</p>
        </div>
      )}

      {preview && !preview.alreadyHere && (
        <div className="rounded-md border bg-bg p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <span className="truncate">{preview.fromName}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted shrink-0" />
            <span className="truncate">{preview.toName}</span>
          </div>
          <div className="mt-1 text-muted tabular-nums">
            {previewing ? "Calculating…" : <>{km(preview.km)} · <span className="text-fg font-medium">{inr(preview.amount)}</span></>}
          </div>
        </div>
      )}
      {preview?.alreadyHere && (
        <p className="text-sm text-amber-600">You are already at this site — pick a different one.</p>
      )}

      {msg && (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            msg.ok ? "border-green-500/30 bg-green-500/10 text-green-600" : "border-red-500/30 bg-red-500/10 text-red-600",
          )}
        >
          {msg.text}
        </div>
      )}

      <button onClick={submit} disabled={pending || preview?.alreadyHere} className="btn-primary w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Log This Visit
      </button>
    </div>
  );
}
