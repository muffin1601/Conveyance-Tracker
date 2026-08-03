"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState, useTransition,
} from "react";
import {
  Loader2, Check, ArrowDown, MapPin, Bike, Car, TrainFront,
  LocateFixed, X, Save, AlertTriangle, RotateCcw, Flag, History,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  logVisit, previewVisit, getJourneyState, resetJourney,
  type JourneyState,
} from "@/app/actions/visit";
import { geocodeCoords, listMyLocations, saveCustomLocation } from "@/app/actions/locations";
import { setActiveEmployee } from "@/app/actions/session";
import { Combobox, type ComboOption } from "@/components/Combobox";
import { useRecentLocations } from "@/hooks/useRecentLocations";
import { useRouter } from "next/navigation";
import type { TravelMode } from "@/lib/travel";
import { cn, inr, km } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";

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

const GROUP_RECENT = "Recent";
const GROUP_SITES = "Master Locations";
const GROUP_SAVED = "My Saved Locations";
const GROUP_ORDER = [GROUP_RECENT, GROUP_SITES, GROUP_SAVED];

/** How long typing/among-inputs settles before the server preview is requested. */
const PREVIEW_DEBOUNCE_MS = 350;

// The active destination the user has chosen.
type Dest =
  | { kind: "SITE"; siteId: string }
  | { kind: "CUSTOM"; customLocationId: string; hasCoords: boolean }
  | { kind: "GPS"; lat: number; lng: number; name: string };

interface Preview {
  fromName: string; toName: string; km: number; amount: number;
  durationMin?: number | null; source?: string; tripNumber: number; alreadyHere: boolean;
}

export function CheckinForm({
  employees, sites, rates, officeName, initialEmployeeId = "",
}: {
  /** Restored from the device cookie so a returning user is already selected. */
  initialEmployeeId?: string;
  employees: Employee[];
  sites: Site[];
  rates: Record<TravelMode, number>;
  officeName: string;
}) {
  const [employeeId, setEmployeeId] = useState(initialEmployeeId);
  const [myLocations, setMyLocations] = useState<CustomLoc[]>([]);
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [dest, setDest] = useState<Dest | null>(null);
  const [mode, setMode] = useState<TravelMode>("BIKE");
  const [fare, setFare] = useState("");
  const [manualKm, setManualKm] = useState("");
  const [useManual, setUseManual] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<"employee" | "dest" | "manualKm" | "fare" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [resetting, startReset] = useTransition();
  const [panel, setPanel] = useState<"none" | "gps">("none");

  const { recent, remember } = useRecentLocations(employeeId);
  const router = useRouter();

  const fareNum = parseFloat(fare);
  const fareInvalid = fare.trim() !== "" && !(fareNum >= 0);
  const useActual = mode === "BUSMETRO" && fareNum > 0;
  const manualKmNum = parseFloat(manualKm);
  const manualInvalid = useManual && manualKm.trim() !== "" && !(manualKmNum > 0);
  const manualActive = useManual && manualKmNum > 0;
  /** Manual entry is still required but not yet filled in — hold the preview. */
  const manualPendingInput = useManual && !manualActive;

  // ── Server state for the selected employee ────────────────────────────
  // Returns what it fetched (not just void) so callers like doReset can read
  // the just-refreshed origin instead of quoting a hardcoded office name —
  // origin varies per employee now, so that name would often be wrong.
  const refreshJourney = useCallback(async (empId: string): Promise<JourneyState | null> => {
    if (!empId) { setJourney(null); return null; }
    setJourneyLoading(true);
    try {
      const j = await getJourneyState(empId);
      setJourney(j);
      return j;
    } catch {
      setJourney(null); // the summary is supplementary — never block logging
      return null;
    } finally {
      setJourneyLoading(false);
    }
  }, []);

  const refreshLocations = useCallback((empId: string) => {
    if (!empId) { setMyLocations([]); return; }
    listMyLocations(empId).then(setMyLocations).catch(() => setMyLocations([]));
  }, []);

  // Both loads are independent — fire them together rather than in sequence.
  // Fetching in response to a changed selection is a legitimate effect; both
  // helpers own their own loading/error state.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    refreshLocations(employeeId);
    void refreshJourney(employeeId);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [employeeId, refreshLocations, refreshJourney]);

  // ── Dropdown options ──────────────────────────────────────────────────
  const employeeOptions = useMemo<ComboOption[]>(
    () => employees.map((e) => ({
      value: e.id,
      label: e.name,
      sublabel: e.designation,
      keywords: e.department,
    })),
    [employees],
  );

  /** Every selectable destination, keyed "SITE:id" / "CUSTOM:id". */
  const baseDestOptions = useMemo<ComboOption[]>(() => {
    const out: ComboOption[] = sites.map((s) => ({
      value: `SITE:${s.id}`,
      label: s.name,
      sublabel: s.city ?? undefined,
      keywords: s.address,
      group: GROUP_SITES,
    }));
    for (const l of myLocations) {
      out.push({
        value: `CUSTOM:${l.id}`,
        label: l.locationName,
        sublabel: l.address ?? ([l.city, l.state].filter(Boolean).join(", ") || undefined),
        group: GROUP_SAVED,
        tag: l.isGlobal ? "shared" : l.latitude == null ? "manual" : undefined,
      });
    }
    return out;
  }, [sites, myLocations]);

  /**
   * Recently-used locations are surfaced as a pinned group at the top. They are
   * copies (not moves) so a location is still findable under its own heading.
   */
  const destOptions = useMemo<ComboOption[]>(() => {
    if (recent.length === 0) return baseDestOptions;
    const byValue = new Map(baseDestOptions.map((o) => [o.value, o]));
    const pinned = recent
      .map((v) => byValue.get(v))
      .filter((o): o is ComboOption => o !== undefined)
      .map((o) => ({ ...o, group: GROUP_RECENT }));
    return pinned.length ? [...pinned, ...baseDestOptions] : baseDestOptions;
  }, [baseDestOptions, recent]);

  // The dropdown value encodes kind+id, e.g. "SITE:abc" / "CUSTOM:xyz".
  const selectValue =
    dest?.kind === "SITE" ? `SITE:${dest.siteId}`
    : dest?.kind === "CUSTOM" ? `CUSTOM:${dest.customLocationId}`
    : "";

  const onSelectDest = useCallback((value: string) => {
    setPanel("none");
    setMsg(null);
    setFieldError(null);
    // Drop the previous estimate immediately — showing the old destination's
    // distance against a new one for the length of the debounce is misleading.
    setPreview(null);
    setPreviewError(null);
    if (!value) { setDest(null); setUseManual(false); return; }
    const sep = value.indexOf(":");
    const kind = value.slice(0, sep);
    const id = value.slice(sep + 1);
    if (kind === "SITE") {
      setDest({ kind: "SITE", siteId: id });
      setUseManual(false);
    } else {
      const loc = myLocations.find((l) => l.id === id);
      const hasCoords = !!(loc && loc.latitude != null && loc.longitude != null);
      setDest({ kind: "CUSTOM", customLocationId: id, hasCoords });
      // Locations without coordinates can't be auto-measured — force manual km.
      setUseManual(!hasCoords);
    }
  }, [myLocations]);

  const onSelectEmployee = useCallback((id: string) => {
    setEmployeeId(id);
    // Persist who this device belongs to, then refresh so Today's Summary
    // re-renders scoped to this employee instead of showing everyone.
    void setActiveEmployee(id).then(() => router.refresh()).catch(() => {});
    setDest(null);
    setPreview(null);
    setPreviewError(null);
    setMsg(null);
    setFieldError(null);
    setUseManual(false);
    setManualKm("");
    setFare("");
  }, [router]);

  const destForApi = useCallback((d: Dest) => {
    if (d.kind === "SITE") return { kind: "SITE" as const, siteId: d.siteId };
    if (d.kind === "CUSTOM") return { kind: "CUSTOM" as const, customLocationId: d.customLocationId };
    return { kind: "GPS" as const, lat: d.lat, lng: d.lng, name: d.name };
  }, []);

  // ── Live preview (debounced, cancellable) ─────────────────────────────
  // Previously this fired a server round-trip on every keystroke of the fare
  // and distance fields; each one resolved a route and could take seconds.
  const previewSeq = useRef(0);
  useEffect(() => {
    // Nothing to price yet. The clearing of any previous estimate is done by
    // the selection handlers, so this effect never writes state on the way out.
    if (!employeeId || !dest || manualPendingInput) return;

    const seq = ++previewSeq.current;
    const timer = setTimeout(() => {
      setPreviewing(true);
      setPreviewError(null);
      previewVisit({
        employeeId,
        destination: destForApi(dest),
        mode,
        fareActual: useActual ? fareNum : undefined,
        manualDistanceKm: manualActive ? manualKmNum : undefined,
      })
        .then((p) => {
          if (seq !== previewSeq.current) return; // a newer request superseded this one
          setPreview(p);
        })
        .catch((e) => {
          if (seq !== previewSeq.current) return;
          setPreview(null);
          setPreviewError(errorMessage(e));
        })
        .finally(() => {
          if (seq === previewSeq.current) setPreviewing(false);
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => { clearTimeout(timer); };
  }, [
    employeeId, dest, mode, useActual, fareNum, manualActive, manualKmNum,
    manualPendingInput, destForApi,
  ]);

  // ── Submit ────────────────────────────────────────────────────────────
  function submit() {
    setMsg(null);
    setFieldError(null);
    if (!employeeId) { setFieldError("employee"); return setMsg({ ok: false, text: "Select your name to continue." }); }
    if (!dest) { setFieldError("dest"); return setMsg({ ok: false, text: "Choose where you are going." }); }
    if (useManual && !(manualKmNum > 0)) {
      setFieldError("manualKm");
      return setMsg({ ok: false, text: "Enter the distance in km (a number greater than 0)." });
    }
    if (fareInvalid) {
      setFieldError("fare");
      return setMsg({ ok: false, text: "Enter a valid fare amount, or leave it blank." });
    }
    if (preview?.alreadyHere) {
      setFieldError("dest");
      return setMsg({ ok: false, text: "You are already at this location — pick a different one." });
    }

    start(async () => {
      try {
        const r = await logVisit({
          employeeId,
          destination: destForApi(dest),
          mode,
          fareActual: useActual ? fareNum : undefined,
          manualDistanceKm: manualActive ? manualKmNum : undefined,
        });
        if (selectValue) remember(selectValue);
        setMsg({ ok: true, text: `Trip ${r.tripNumber} logged · ${r.from} → ${r.site} · ${km(r.km)} · ${inr(r.amount)}.` });
        setDest(null); setFare(""); setManualKm(""); setUseManual(false); setPreview(null);
        await refreshJourney(employeeId);
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    });
  }

  function doReset() {
    if (!employeeId) return;
    if (!confirm("Restart the journey? Your next trip will start from your usual starting point again. Trips already logged are kept.")) return;
    startReset(async () => {
      try {
        const r = await resetJourney(employeeId);
        if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
        setDest(null); setPreview(null); setUseManual(false); setManualKm("");
        const refreshed = await refreshJourney(employeeId);
        setMsg({ ok: true, text: `Journey restarted — your next trip starts from ${refreshed?.fromName ?? officeName}.` });
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    });
  }

  // ── Derived display values ────────────────────────────────────────────
  const tripNumber = preview?.tripNumber ?? journey?.tripNumber ?? 1;
  const fromName = preview?.fromName ?? journey?.fromName ?? officeName;
  const atOrigin = journey ? journey.atOrigin : true;
  // The starting point's OWN address — never a fallback to the head office's.
  // Previously this box always showed the head office's address whenever the trip was
  // starting fresh, so an employee whose day starts at another site (e.g. the
  // showroom) saw that site's name paired with the head office's street
  // address underneath. Left blank until the real address is known rather
  // than guessing.
  const fromAddress = journey?.fromAddress ?? null;
  const destLabel =
    dest?.kind === "GPS" ? dest.name
    : dest?.kind === "CUSTOM" ? myLocations.find((l) => l.id === dest.customLocationId)?.locationName ?? "Saved location"
    : dest?.kind === "SITE" ? sites.find((s) => s.id === dest.siteId)?.name ?? "Selected site"
    : null;
  const destSub =
    dest?.kind === "SITE" ? sites.find((s) => s.id === dest.siteId)?.address ?? null : null;

  const canSubmit = !pending && !!employeeId && !!dest && !preview?.alreadyHere && !manualPendingInput;

  return (
    <div className="space-y-5">
      {/* ── Who ─────────────────────────────────────────────────────── */}
      <div>
        <label className="label" htmlFor="emp">Your Name</label>
        <Combobox
          id="emp"
          options={employeeOptions}
          value={employeeId}
          onChange={onSelectEmployee}
          placeholder="— Select your name —"
          searchPlaceholder="Search by name, role or department…"
          emptyMessage="No employee matches that search."
          invalid={fieldError === "employee"}
        />
      </div>

      {employeeId && (
        <>
          {/* ── Trip header + journey summary ─────────────────────────── */}
          <div className="rounded-lg border bg-bg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="badge border-brand/30 bg-brand/10 text-brand">Trip {tripNumber}</span>
                {atOrigin && <span className="text-xs text-muted">Starting a new journey</span>}
              </div>
              <button
                type="button"
                onClick={doReset}
                disabled={resetting || journeyLoading}
                className="btn-ghost h-8 px-2.5 text-xs"
              >
                {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Reset Journey
              </button>
            </div>

            {/* Starting point → destination flow */}
            <div className="mt-3 space-y-1.5">
              <Endpoint
                caption="Starting Point"
                name={fromName}
                sub={atOrigin && fromAddress ? fromAddress : undefined}
                locked={!atOrigin}
                lockNote={!atOrigin ? "Carried over from your last trip" : undefined}
              />
              <div className="flex justify-center">
                <ArrowDown className="h-4 w-4 text-muted" />
              </div>
              <Endpoint
                caption="Destination"
                name={destLabel ?? "Not selected yet"}
                sub={destSub ?? undefined}
                muted={!destLabel}
              />
            </div>

            {/* Today's running totals */}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Today&apos;s Distance</div>
                <div className="font-semibold tabular-nums">
                  {journeyLoading && !journey ? "—" : km(journey?.totalKm ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Today&apos;s Conveyance</div>
                <div className="font-semibold tabular-nums text-brand">
                  {journeyLoading && !journey ? "—" : inr(journey?.totalAmount ?? 0)}
                </div>
              </div>
            </div>
          </div>

          {/* ── Where ─────────────────────────────────────────────────── */}
          <div>
            <label className="label" htmlFor="dest">Where Are You Going</label>
            {dest?.kind === "GPS" ? (
              <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 p-2.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span className="min-w-0 flex-1">{dest.name}</span>
                <button
                  type="button"
                  aria-label="Clear GPS destination"
                  onClick={() => { setDest(null); setUseManual(false); }}
                  className="text-muted hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Combobox
                id="dest"
                options={destOptions}
                value={selectValue}
                onChange={onSelectDest}
                groupOrder={GROUP_ORDER}
                placeholder="— Select a location —"
                searchPlaceholder="Search locations…"
                emptyMessage="No location matches that search."
                invalid={fieldError === "dest"}
              />
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPanel(panel === "gps" ? "none" : "gps")}
                className="btn-ghost text-xs"
              >
                <LocateFixed className="h-3.5 w-3.5" /> Use Current GPS
              </button>
            </div>
          </div>

          {panel === "gps" && (
            <GpsCapture
              employeeId={employeeId}
              onUse={(d) => {
                setDest(d); setPanel("none"); setUseManual(false);
                setFieldError(null); setPreview(null); setPreviewError(null);
              }}
              onSaved={() => { refreshLocations(employeeId); }}
            />
          )}
        </>
      )}

      {/* ── Mode of transport ───────────────────────────────────────── */}
      <div>
        <label className="label">Mode of Transport</label>
        <div className="grid grid-cols-3 gap-3">
          {MODES.map((m) => (
            <button
              type="button"
              key={m.key}
              aria-pressed={mode === m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                "rounded-lg border p-4 text-center transition",
                mode === m.key ? "border-brand bg-brand/10" : "hover:bg-bg",
              )}
            >
              <m.Icon className={cn("mx-auto h-6 w-6", mode === m.key ? "text-brand" : "text-muted")} />
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
            aria-invalid={fareInvalid || fieldError === "fare" || undefined}
            className={cn("input", (fareInvalid || fieldError === "fare") && "border-red-500")}
            placeholder="Leave blank to auto-calculate by distance"
            value={fare}
            onChange={(e) => { setFare(e.target.value); setFieldError(null); }}
          />
          {fareInvalid && <p className="mt-1 text-xs text-red-600">Enter a valid amount, or leave this blank.</p>}
        </div>
      )}

      {/* Manual distance — for GPS/custom legs when auto-calc is unavailable */}
      {dest && dest.kind !== "SITE" && (
        <div className="rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useManual}
              onChange={(e) => {
                setUseManual(e.target.checked);
                setFieldError(null);
                setPreview(null);
                setPreviewError(null);
              }}
            />
            Enter distance manually (if automatic calculation is unavailable)
          </label>
          {useManual && (
            <>
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                aria-label="Distance in km"
                aria-invalid={manualInvalid || fieldError === "manualKm" || undefined}
                className={cn("input mt-2", (manualInvalid || fieldError === "manualKm") && "border-red-500")}
                placeholder="Distance in km"
                value={manualKm}
                onChange={(e) => { setManualKm(e.target.value); setFieldError(null); }}
              />
              {manualInvalid && <p className="mt-1 text-xs text-red-600">Distance must be a number greater than 0.</p>}
            </>
          )}
        </div>
      )}

      {/* ── Live estimate ───────────────────────────────────────────── */}
      {employeeId && dest && !preview?.alreadyHere && (
        <div className="rounded-md border bg-bg p-3 text-sm">
          {!preview && !previewError && !manualPendingInput ? (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculating distance and fare…
            </div>
          ) : previewError ? (
            <div className="flex items-start gap-2 text-red-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{previewError}</span>
            </div>
          ) : preview ? (
            <div className={cn("transition-opacity", previewing && "opacity-50")}>
              <div className="flex items-center gap-2 font-medium">
                <span className="truncate">{preview.fromName}</span>
                <ArrowDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-muted" />
                <span className="truncate">{preview.toName}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Distance</div>
                  <div className="tabular-nums">{km(preview.km)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Fare</div>
                  <div className="font-medium tabular-nums text-brand">{inr(preview.amount)}</div>
                </div>
              </div>
              {(preview.durationMin || preview.source === "MANUAL") && (
                <p className="mt-1 text-xs text-muted">
                  {preview.durationMin ? `~${preview.durationMin} min` : ""}
                  {preview.durationMin && preview.source === "MANUAL" ? " · " : ""}
                  {preview.source === "MANUAL" ? "distance entered manually" : ""}
                </p>
              )}
            </div>
          ) : manualPendingInput ? (
            <p className="text-muted">Enter the distance above to see the fare.</p>
          ) : null}
        </div>
      )}

      {preview?.alreadyHere && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600">
          You are already at this location — pick a different destination.
        </p>
      )}

      {msg && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-md border p-3 text-sm",
            msg.ok
              ? "border-green-500/30 bg-green-500/10 text-green-600"
              : "border-red-500/30 bg-red-500/10 text-red-600",
          )}
        >
          {msg.text}
        </div>
      )}

      <button onClick={submit} disabled={!canSubmit} className="btn-primary w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {pending ? "Logging…" : "Log This Visit"}
      </button>

      {/* ── Today's trip timeline ───────────────────────────────────── */}
      {employeeId && journey && journey.legs.length > 0 && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <History className="h-3.5 w-3.5" /> Recent Trips Today
          </div>
          <ol className="space-y-2">
            {[...journey.legs].reverse().map((l) => (
              <li key={l.id} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold tabular-nums text-brand">
                  {l.sequence + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {l.fromName} <span className="text-muted">→</span> {l.toName}
                  </span>
                  {!l.chained && (
                    <span className="text-xs text-muted">Journey was restarted after this trip</span>
                  )}
                </span>
                <span className="shrink-0 pl-2 text-right tabular-nums">
                  {km(l.distanceKm)} · {inr(l.amount)}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold tabular-nums">
            <span className="flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5 text-muted" /> Journey Total
            </span>
            <span>{km(journey.totalKm)} · {inr(journey.totalAmount)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** One labelled endpoint row in the trip flow. */
function Endpoint({
  caption, name, sub, locked, lockNote, muted,
}: {
  caption: string;
  name: string;
  sub?: string;
  locked?: boolean;
  lockNote?: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md border bg-surface p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <MapPin className="h-3 w-3" /> {caption}
        {locked && <span className="badge bg-bg text-[10px] normal-case tracking-normal text-muted">auto</span>}
      </div>
      <div className={cn("mt-0.5 font-semibold leading-tight", muted ? "text-muted" : "text-fg")}>{name}</div>
      {sub && <div className="mt-0.5 text-xs leading-snug text-muted">{sub}</div>}
      {lockNote && <div className="mt-0.5 text-xs text-muted">{lockNote}</div>}
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
  const [detected, setDetected] = useState<{
    lat: number; lng: number; address: string;
    city: string | null; state: string | null; country: string | null; postalCode: string | null;
  } | null>(null);
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
          setDetected({
            lat: latitude, lng: longitude, address: g.address,
            city: g.city, state: g.state, country: g.country, postalCode: g.postalCode,
          });
          setSaveName(g.area || g.city || "New location");
          setStatus("done");
        } catch (e) {
          setStatus("error"); setError(errorMessage(e));
        }
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Enable it in your browser settings, or add the location manually."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Your location is unavailable right now. Try again or add it manually."
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
      setError(errorMessage(e));
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
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
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{error}</p>
            <button type="button" onClick={locate} className="btn-ghost mt-2 text-xs">Try again</button>
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
            <p className="mt-0.5 text-xs tabular-nums text-muted">
              {detected.lat.toFixed(5)}, {detected.lng.toFixed(5)}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onUse({
              kind: "GPS",
              lat: detected.lat,
              lng: detected.lng,
              name: detected.city
                ? `${detected.city}${detected.state ? `, ${detected.state}` : ""}`
                : detected.address.split(",").slice(0, 2).join(","),
            })}
            className="btn-primary w-full text-sm"
          >
            <Check className="h-4 w-4" /> Use This Location
          </button>

          <div className="rounded-md border p-2">
            <p className="text-sm font-medium">Save as a reusable location?</p>
            {saved ? (
              <p className="mt-1 text-sm text-green-600">Saved to your locations.</p>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  aria-label="Location name"
                  placeholder="Location name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
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
