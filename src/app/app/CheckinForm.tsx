"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import {
  Loader2, Check, ArrowRight, MapPin, Bike, Car, TrainFront,
  LocateFixed, X, Save, AlertTriangle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { logVisit, previewVisit } from "@/app/actions/visit";
import { geocodeCoords, listMyLocations, saveCustomLocation } from "@/app/actions/locations";
import type { TravelMode } from "@/lib/travel";
import { cn, inr, km } from "@/lib/utils";

interface Employee { id: string; name: string; designation: string; department: string }
interface Site { id: string; name: string; city: string | null; address: string }
interface CustomLoc {
  id: string; locationName: string; address: string | null;
  latitude: number | null; longitude: number | null;
  city: string | null; state: string | null; isGlobal: boolean; source: string;
}

const MODES: { key: TravelMode; label: string; Icon: LucideIcon }[] = [
  { key: "BIKE", label: "Bike", Icon: Bike },
  { key: "CAR", label: "Car", Icon: Car },
  { key: "BUSMETRO", label: "Bus/Metro", Icon: TrainFront },
];

// The active destination the user has chosen.
type Dest =
  | { kind: "SITE"; siteId: string }
  | { kind: "CUSTOM"; customLocationId: string; hasCoords: boolean }
  | { kind: "GPS"; lat: number; lng: number; name: string };

interface Preview {
  fromName: string; toName: string; km: number; amount: number;
  durationMin?: number | null; source?: string; alreadyHere: boolean;
}

export function CheckinForm({
  employees, sites, rates, officeName, officeAddress,
}: {
  employees: Employee[];
  sites: Site[];
  rates: Record<TravelMode, number>;
  officeName: string;
  officeAddress: string;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [myLocations, setMyLocations] = useState<CustomLoc[]>([]);
  const [dest, setDest] = useState<Dest | null>(null);
  const [mode, setMode] = useState<TravelMode>("BIKE");
  const [fare, setFare] = useState("");
  const [manualKm, setManualKm] = useState("");
  const [useManual, setUseManual] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pending, start] = useTransition();

  // GPS / custom-location UI panels.
  const [panel, setPanel] = useState<"none" | "gps">("none");

  const fareNum = parseFloat(fare);
  const useActual = mode === "BUSMETRO" && fareNum > 0;
  const manualKmNum = parseFloat(manualKm);
  const manualActive = useManual && manualKmNum > 0;

  const refreshLocations = useCallback((empId: string) => {
    if (!empId) { setMyLocations([]); return; }
    listMyLocations(empId).then(setMyLocations).catch(() => setMyLocations([]));
  }, []);

  useEffect(() => { refreshLocations(employeeId); }, [employeeId, refreshLocations]);

  // The dropdown value encodes kind+id, e.g. "SITE:abc" / "CUSTOM:xyz".
  const selectValue =
    dest?.kind === "SITE" ? `SITE:${dest.siteId}`
    : dest?.kind === "CUSTOM" ? `CUSTOM:${dest.customLocationId}`
    : "";

  function onSelectDest(value: string) {
    setPanel("none");
    setMsg(null);
    if (!value) { setDest(null); return; }
    const [kind, id] = value.split(":");
    if (kind === "SITE") setDest({ kind: "SITE", siteId: id });
    else {
      const loc = myLocations.find((l) => l.id === id);
      const hasCoords = !!(loc && loc.latitude != null && loc.longitude != null);
      setDest({ kind: "CUSTOM", customLocationId: id, hasCoords });
      // Locations without coordinates can't be auto-measured — force manual km.
      setUseManual(!hasCoords);
    }
  }

  // Live preview whenever inputs change.
  useEffect(() => {
    if (!employeeId || !dest) { setPreview(null); return; }
    if (manualActive === false && useManual) { setPreview(null); return; }
    let cancelled = false;
    setPreviewing(true);
    previewVisit({
      employeeId,
      destination: destForApi(dest),
      mode,
      fareActual: useActual ? fareNum : undefined,
      manualDistanceKm: manualActive ? manualKmNum : undefined,
    })
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setPreviewing(false); });
    return () => { cancelled = true; };
  }, [employeeId, dest, mode, useActual, fareNum, manualActive, manualKmNum, useManual]);

  function destForApi(d: Dest) {
    if (d.kind === "SITE") return { kind: "SITE" as const, siteId: d.siteId };
    if (d.kind === "CUSTOM") return { kind: "CUSTOM" as const, customLocationId: d.customLocationId };
    return { kind: "GPS" as const, lat: d.lat, lng: d.lng, name: d.name };
  }

  function submit() {
    setMsg(null);
    if (!employeeId) return setMsg({ ok: false, text: "Select your name." });
    if (!dest) return setMsg({ ok: false, text: "Choose where you are going." });
    if (useManual && !(manualKmNum > 0)) return setMsg({ ok: false, text: "Enter the distance in km." });
    start(async () => {
      try {
        const r = await logVisit({
          employeeId,
          destination: destForApi(dest),
          mode,
          fareActual: useActual ? fareNum : undefined,
          manualDistanceKm: manualActive ? manualKmNum : undefined,
        });
        setMsg({ ok: true, text: `${r.from} → ${r.site} · ${km(r.km)} · ${inr(r.amount)} logged.` });
        setDest(null); setFare(""); setManualKm(""); setUseManual(false); setPreview(null);
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
      }
    });
  }

  const destName =
    dest?.kind === "GPS" ? dest.name
    : dest?.kind === "CUSTOM" ? myLocations.find((l) => l.id === dest.customLocationId)?.locationName
    : sites.find((s) => s.id === (dest?.kind === "SITE" ? dest.siteId : ""))?.address;

  return (
    <div className="space-y-5">
      <div>
        <label className="label" htmlFor="emp">Your Name</label>
        <select id="emp" className="input" value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setDest(null); setPreview(null); }}>
          <option value="">— Select your name —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name} · {e.designation}</option>
          ))}
        </select>
      </div>

      {/* Starting point — auto-resolved. */}
      {employeeId && (() => {
        const fromName = preview?.fromName ?? officeName;
        const atOffice = !preview || preview.fromName === officeName;
        return (
          <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand">
              <MapPin className="h-3.5 w-3.5" /> Starting from
            </div>
            <div className="mt-1 font-semibold text-fg leading-tight">{fromName}</div>
            {atOffice && officeAddress && <div className="mt-0.5 text-xs text-muted leading-snug">{officeAddress}</div>}
          </div>
        );
      })()}

      {/* Destination picker */}
      <div>
        <label className="label" htmlFor="dest">Where Are You Going</label>
        <select id="dest" className="input" value={selectValue} onChange={(e) => onSelectDest(e.target.value)} disabled={dest?.kind === "GPS"}>
          <option value="">— Select a location —</option>
          <optgroup label="▼ Master Locations">
            {sites.map((s) => (
              <option key={s.id} value={`SITE:${s.id}`}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>
            ))}
          </optgroup>
          {myLocations.length > 0 && (
            <optgroup label="★ My Saved Locations">
              {myLocations.map((l) => (
                <option key={l.id} value={`CUSTOM:${l.id}`}>
                  {l.locationName}{l.isGlobal ? " (shared)" : ""}{l.latitude == null ? " · manual" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {/* GPS destination chip */}
        {dest?.kind === "GPS" && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 p-2 text-sm">
            <MapPin className="h-4 w-4 text-brand shrink-0 mt-0.5" />
            <span className="min-w-0 flex-1 truncate">{dest.name}</span>
            <button type="button" onClick={() => { setDest(null); setUseManual(false); }} className="text-muted hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
        )}
        {dest?.kind === "SITE" && destName && <p className="text-xs text-muted mt-1 truncate">{destName}</p>}

        {/* Actions */}
        {employeeId && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setPanel(panel === "gps" ? "none" : "gps")} className="btn-ghost text-xs">
              <LocateFixed className="h-3.5 w-3.5" /> Use Current GPS
            </button>
          </div>
        )}
      </div>

      {panel === "gps" && employeeId && (
        <GpsCapture
          employeeId={employeeId}
          onUse={(d) => { setDest(d); setPanel("none"); setUseManual(false); }}
          onSaved={() => { refreshLocations(employeeId); }}
        />
      )}

      {/* Mode of transport */}
      <div>
        <label className="label">Mode of Transport</label>
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((m) => (
            <button type="button" key={m.key} onClick={() => setMode(m.key)}
              className={cn("rounded-lg border p-4 text-center transition", mode === m.key ? "border-brand bg-brand/10" : "hover:bg-bg")}>
              <m.Icon className={cn("h-6 w-6 mx-auto", mode === m.key ? "text-brand" : "text-muted")} />
              <div className="mt-1.5 text-sm font-medium">{m.label}</div>
              <div className="text-xs text-muted">{m.key === "BUSMETRO" ? `₹${rates[m.key]}/km or actual` : `₹${rates[m.key]}/km`}</div>
            </button>
          ))}
        </div>
      </div>

      {mode === "BUSMETRO" && (
        <div>
          <label className="label" htmlFor="fare">Actual Fare (₹) — optional</label>
          <input id="fare" type="number" min="0" step="1" inputMode="decimal" className="input"
            placeholder="Leave blank to auto-calculate by distance" value={fare} onChange={(e) => setFare(e.target.value)} />
        </div>
      )}

      {/* Manual distance — for GPS/custom legs when auto-calc is unavailable */}
      {dest && dest.kind !== "SITE" && (
        <div className="rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} />
            Enter distance manually (if automatic calculation is unavailable)
          </label>
          {useManual && (
            <input type="number" min="0" step="0.1" inputMode="decimal" className="input mt-2"
              placeholder="Distance in km" value={manualKm} onChange={(e) => setManualKm(e.target.value)} />
          )}
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
            {previewing ? "Calculating…" : (
              <>{km(preview.km)} · <span className="text-fg font-medium">{inr(preview.amount)}</span>
                {preview.durationMin ? ` · ~${preview.durationMin} min` : ""}
                {preview.source === "MANUAL" ? " · manual" : ""}</>
            )}
          </div>
        </div>
      )}
      {preview?.alreadyHere && <p className="text-sm text-amber-600">You are already at this location — pick a different one.</p>}

      {msg && (
        <div className={cn("rounded-md border p-3 text-sm", msg.ok ? "border-green-500/30 bg-green-500/10 text-green-600" : "border-red-500/30 bg-red-500/10 text-red-600")}>
          {msg.text}
        </div>
      )}

      <button onClick={submit} disabled={pending || preview?.alreadyHere} className="btn-primary w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Log This Visit
      </button>
    </div>
  );
}

// ── GPS capture panel ────────────────────────────────────────────────
function GpsCapture({
  employeeId, onUse, onSaved,
}: {
  employeeId: string;
  onUse: (d: Dest) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "geocoding" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [detected, setDetected] = useState<{ lat: number; lng: number; address: string; city: string | null; state: string | null; country: string | null; postalCode: string | null } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function locate() {
    setError(""); setDetected(null); setSaved(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error"); setError("Your browser does not support location access."); return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setStatus("geocoding");
        try {
          const g = await geocodeCoords(latitude, longitude);
          setDetected({ lat: latitude, lng: longitude, address: g.address, city: g.city, state: g.state, country: g.country, postalCode: g.postalCode });
          setSaveName(g.area || g.city || "New location");
          setStatus("done");
        } catch (e) {
          setStatus("error"); setError((e as Error).message);
        }
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED ? "Location permission denied. Enable it in your browser settings, or add the location manually."
          : err.code === err.POSITION_UNAVAILABLE ? "Your location is unavailable right now. Try again or add it manually."
          : "Could not get your location. Try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function saveThis() {
    if (!detected) return;
    setSaving(true);
    try {
      await saveCustomLocation({
        employeeId, locationName: saveName.trim() || "New location",
        address: detected.address, city: detected.city ?? "", state: detected.state ?? "",
        country: detected.country ?? "", postalCode: detected.postalCode ?? "",
        latitude: detected.lat, longitude: detected.lng, source: "GPS",
      });
      setSaved(true); onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LocateFixed className="h-4 w-4 text-brand" /> Use your current location
      </div>

      {status === "idle" && (
        <button type="button" onClick={locate} className="btn-primary w-full text-sm">
          <LocateFixed className="h-4 w-4" /> Detect My Location
        </button>
      )}
      {(status === "locating" || status === "geocoding") && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status === "locating" ? "Getting GPS fix…" : "Looking up address…"}
        </div>
      )}
      {status === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-600">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            <button type="button" onClick={locate} className="btn-ghost text-xs mt-2">Try again</button>
          </div>
        </div>
      )}

      {status === "done" && detected && (
        <div className="space-y-3">
          <div className="rounded-md border bg-bg p-2 text-sm">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand">
              <MapPin className="h-3.5 w-3.5" /> Detected address
            </div>
            <p className="mt-1 leading-snug">{detected.address}</p>
            <p className="mt-0.5 text-xs text-muted tabular-nums">{detected.lat.toFixed(5)}, {detected.lng.toFixed(5)}</p>
          </div>

          <button type="button" onClick={() => onUse({ kind: "GPS", lat: detected.lat, lng: detected.lng, name: detected.city ? `${detected.city}${detected.state ? `, ${detected.state}` : ""}` : detected.address.split(",").slice(0, 2).join(",") })}
            className="btn-primary w-full text-sm">
            <Check className="h-4 w-4" /> Use This Location
          </button>

          <div className="rounded-md border p-2">
            <p className="text-sm font-medium">Save as a reusable location?</p>
            {saved ? (
              <p className="mt-1 text-sm text-green-600">Saved to your locations.</p>
            ) : (
              <div className="mt-2 flex gap-2">
                <input className="input flex-1 text-sm" placeholder="Location name" value={saveName} onChange={(e) => setSaveName(e.target.value)} />
                <button type="button" onClick={saveThis} disabled={saving} className="btn-ghost text-sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
