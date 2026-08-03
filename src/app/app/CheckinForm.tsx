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
import { NavigateButton } from "@/components/NavigateButton";
import { useRecentLocations } from "@/hooks/useRecentLocations";
import { useRouter } from "next/navigation";
import type { TravelMode } from "@/lib/travel";
import { cn, inr, km } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { t, type Lang, type DictKey } from "@/lib/i18n";

interface Employee { id: string; name: string; designation: string; department: string }
interface Site {
  id: string; name: string; city: string | null; address: string;
  landmark: string | null; latitude: number; longitude: number;
}
interface CustomLoc {
  id: string; locationName: string; address: string | null;
  latitude: number | null; longitude: number | null;
  city: string | null; state: string | null; isGlobal: boolean; source: string;
}

const MODES: { key: TravelMode; labelKey: DictKey; Icon: LucideIcon }[] = [
  { key: "BIKE", labelKey: "bike", Icon: Bike },
  { key: "CAR", labelKey: "car", Icon: Car },
  { key: "BUSMETRO", labelKey: "busMetro", Icon: TrainFront },
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
  employees, sites, rates, officeName, initialEmployeeId = "", lang,
}: {
  /** Restored from the device cookie so a returning user is already selected. */
  initialEmployeeId?: string;
  employees: Employee[];
  sites: Site[];
  rates: Record<TravelMode, number>;
  officeName: string;
  lang: Lang;
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
      keywords: [s.address, s.landmark].filter(Boolean).join(" "),
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
    if (!employeeId) { setFieldError("employee"); return setMsg({ ok: false, text: t(lang, "selectNameContinue") }); }
    if (!dest) { setFieldError("dest"); return setMsg({ ok: false, text: t(lang, "chooseDestination") }); }
    if (useManual && !(manualKmNum > 0)) {
      setFieldError("manualKm");
      return setMsg({ ok: false, text: t(lang, "enterDistanceValid") });
    }
    if (fareInvalid) {
      setFieldError("fare");
      return setMsg({ ok: false, text: t(lang, "enterValidFare") });
    }
    if (preview?.alreadyHere) {
      setFieldError("dest");
      return setMsg({ ok: false, text: t(lang, "alreadyHere") });
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
        setMsg({ ok: true, text: t(lang, "tripLoggedMsg", { n: String(r.tripNumber), from: r.from, to: r.site, km: km(r.km), amount: inr(r.amount) }) });
        setDest(null); setFare(""); setManualKm(""); setUseManual(false); setPreview(null);
        await refreshJourney(employeeId);
      } catch (e) {
        setMsg({ ok: false, text: errorMessage(e) });
      }
    });
  }

  function doReset() {
    if (!employeeId) return;
    if (!confirm(t(lang, "confirmResetJourney"))) return;
    startReset(async () => {
      try {
        const r = await resetJourney(employeeId);
        if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
        setDest(null); setPreview(null); setUseManual(false); setManualKm("");
        const refreshed = await refreshJourney(employeeId);
        setMsg({ ok: true, text: t(lang, "journeyRestartedMsg", { from: refreshed?.fromName ?? officeName }) });
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
    : dest?.kind === "CUSTOM" ? myLocations.find((l) => l.id === dest.customLocationId)?.locationName ?? t(lang, "savedLocationLabel")
    : dest?.kind === "SITE" ? sites.find((s) => s.id === dest.siteId)?.name ?? t(lang, "selectedSiteLabel")
    : null;
  const destSub =
    dest?.kind === "SITE" ? sites.find((s) => s.id === dest.siteId)?.address ?? null : null;
  /** Coordinates of the current destination, for its Navigate link — whichever kind it is. */
  const destCoords =
    dest?.kind === "GPS" ? { lat: dest.lat, lng: dest.lng }
    : dest?.kind === "CUSTOM"
      ? (() => {
          const l = myLocations.find((c) => c.id === dest.customLocationId);
          return l?.latitude != null && l?.longitude != null ? { lat: l.latitude, lng: l.longitude } : null;
        })()
    : dest?.kind === "SITE"
      ? (() => {
          const s = sites.find((x) => x.id === dest.siteId);
          return s ? { lat: s.latitude, lng: s.longitude } : null;
        })()
    : null;

  const canSubmit = !pending && !!employeeId && !!dest && !preview?.alreadyHere && !manualPendingInput;

  return (
    <div className="space-y-5">
      {/* ── Who ─────────────────────────────────────────────────────── */}
      <div>
        <label className="label" htmlFor="emp">{t(lang, "yourName")}</label>
        <Combobox
          id="emp"
          options={employeeOptions}
          value={employeeId}
          onChange={onSelectEmployee}
          placeholder={t(lang, "selectYourName")}
          searchPlaceholder={t(lang, "searchByName")}
          emptyMessage={t(lang, "noEmployeeMatch")}
          invalid={fieldError === "employee"}
        />
      </div>

      {employeeId && (
        <>
          {/* ── Trip header + journey summary ─────────────────────────── */}
          <div className="rounded-lg border bg-bg p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="badge border-brand/30 bg-brand/10 text-brand">{t(lang, "trip")} {tripNumber}</span>
                {atOrigin && <span className="text-xs text-muted">{t(lang, "startingNewJourney")}</span>}
              </div>
              <button
                type="button"
                onClick={doReset}
                disabled={resetting || journeyLoading}
                className="btn-ghost h-8 px-2.5 text-xs"
              >
                {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                {t(lang, "resetJourney")}
              </button>
            </div>

            {/* Starting point → destination flow */}
            <div className="mt-3 space-y-1.5">
              <Endpoint
                caption={t(lang, "startingPoint")}
                name={fromName}
                sub={atOrigin && fromAddress ? fromAddress : undefined}
                locked={!atOrigin}
                lockNote={!atOrigin ? t(lang, "carriedOver") : undefined}
                lat={journey?.fromLat ?? null}
                lng={journey?.fromLng ?? null}
                autoLabel={t(lang, "auto")}
              />
              <div className="flex justify-center">
                <ArrowDown className="h-4 w-4 text-muted" />
              </div>
              <Endpoint
                caption={t(lang, "destination")}
                name={destLabel ?? t(lang, "notSelectedYet")}
                sub={destSub ?? undefined}
                muted={!destLabel}
                lat={destCoords?.lat ?? null}
                lng={destCoords?.lng ?? null}
                autoLabel={t(lang, "auto")}
              />
            </div>

            {/* Today's running totals */}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t(lang, "todaysDistance")}</div>
                <div className="font-semibold tabular-nums">
                  {journeyLoading && !journey ? "—" : km(journey?.totalKm ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t(lang, "todaysConveyance")}</div>
                <div className="font-semibold tabular-nums text-brand">
                  {journeyLoading && !journey ? "—" : inr(journey?.totalAmount ?? 0)}
                </div>
              </div>
            </div>
          </div>

          {/* ── Where ─────────────────────────────────────────────────── */}
          <div>
            <label className="label" htmlFor="dest">{t(lang, "whereGoing")}</label>
            {dest?.kind === "GPS" ? (
              <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 p-2.5 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <span className="min-w-0 flex-1">{dest.name}</span>
                <button
                  type="button"
                  aria-label={t(lang, "clearGpsDestination")}
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
                placeholder={t(lang, "selectLocation")}
                searchPlaceholder={t(lang, "searchLocations")}
                emptyMessage={t(lang, "noLocationMatch")}
                invalid={fieldError === "dest"}
              />
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPanel(panel === "gps" ? "none" : "gps")}
                className="btn-ghost text-xs"
              >
                <LocateFixed className="h-3.5 w-3.5" /> {t(lang, "useCurrentGps")}
              </button>
            </div>
          </div>

          {panel === "gps" && (
            <GpsCapture
              lang={lang}
              employeeId={employeeId}
              fromLat={journey?.fromLat ?? null}
              fromLng={journey?.fromLng ?? null}
              fromName={journey?.fromName ?? null}
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
        <label className="label">{t(lang, "modeOfTransport")}</label>
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
              <div className="mt-1.5 text-sm font-medium">{t(lang, m.labelKey)}</div>
              <div className="text-xs text-muted">
                {m.key === "BUSMETRO"
                  ? `₹${rates[m.key]}${t(lang, "perKm")} ${t(lang, "orActual")}`
                  : `₹${rates[m.key]}${t(lang, "perKm")}`}
              </div>
            </button>
          ))}
        </div>
      </div>

      {mode === "BUSMETRO" && (
        <div>
          <label className="label" htmlFor="fare">{t(lang, "actualFare")}</label>
          <input
            id="fare"
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            aria-invalid={fareInvalid || fieldError === "fare" || undefined}
            className={cn("input", (fareInvalid || fieldError === "fare") && "border-red-500")}
            placeholder={t(lang, "leaveBlankAutoCalc")}
            value={fare}
            onChange={(e) => { setFare(e.target.value); setFieldError(null); }}
          />
          {fareInvalid && <p className="mt-1 text-xs text-red-600">{t(lang, "leaveBlankAutoCalc")}</p>}
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
            {t(lang, "enterDistanceManually")}
          </label>
          {useManual && (
            <>
              <input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                aria-label={t(lang, "distanceInKm")}
                aria-invalid={manualInvalid || fieldError === "manualKm" || undefined}
                className={cn("input mt-2", (manualInvalid || fieldError === "manualKm") && "border-red-500")}
                placeholder={t(lang, "distanceInKm")}
                value={manualKm}
                onChange={(e) => { setManualKm(e.target.value); setFieldError(null); }}
              />
              {manualInvalid && <p className="mt-1 text-xs text-red-600">{t(lang, "enterDistanceValid")}</p>}
            </>
          )}
        </div>
      )}

      {/* ── Live estimate ───────────────────────────────────────────── */}
      {employeeId && dest && !preview?.alreadyHere && (
        <div className="rounded-md border bg-bg p-3 text-sm">
          {!preview && !previewError && !manualPendingInput ? (
            <div className="flex items-center gap-2 text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> {t(lang, "calculating")}
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
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t(lang, "distance")}</div>
                  <div className="tabular-nums">{km(preview.km)}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t(lang, "fare")}</div>
                  <div className="font-medium tabular-nums text-brand">{inr(preview.amount)}</div>
                </div>
              </div>
              {(preview.durationMin || preview.source === "MANUAL") && (
                <p className="mt-1 text-xs text-muted">
                  {preview.durationMin ? `~${preview.durationMin} min` : ""}
                  {preview.durationMin && preview.source === "MANUAL" ? " · " : ""}
                  {preview.source === "MANUAL" ? t(lang, "manualEntry") : ""}
                </p>
              )}
            </div>
          ) : manualPendingInput ? (
            <p className="text-muted">{t(lang, "enterDistanceAbove")}</p>
          ) : null}
        </div>
      )}

      {preview?.alreadyHere && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600">
          {t(lang, "alreadyHere")}
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
        {pending ? t(lang, "loggingInProgress") : t(lang, "logThisVisit")}
      </button>

      {/* ── Today's trip timeline ───────────────────────────────────── */}
      {employeeId && journey && journey.legs.length > 0 && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <History className="h-3.5 w-3.5" /> {t(lang, "recentTripsToday")}
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
                    <span className="text-xs text-muted">{t(lang, "journeyRestarted")}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 pl-2">
                  <span className="text-right tabular-nums">{km(l.distanceKm)} · {inr(l.amount)}</span>
                  <NavigateButton lat={l.toLat} lng={l.toLng} compact />
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-semibold tabular-nums">
            <span className="flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5 text-muted" /> {t(lang, "journeyTotal")}
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
  caption, name, sub, locked, lockNote, muted, lat, lng, autoLabel,
}: {
  caption: string;
  name: string;
  sub?: string;
  locked?: boolean;
  lockNote?: string;
  muted?: boolean;
  lat?: number | null;
  lng?: number | null;
  autoLabel?: string;
}) {
  return (
    <div className="rounded-md border bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <MapPin className="h-3 w-3" /> {caption}
          {locked && <span className="badge bg-bg text-[10px] normal-case tracking-normal text-muted">{autoLabel ?? "auto"}</span>}
        </div>
        {!muted && <NavigateButton lat={lat} lng={lng} compact />}
      </div>
      <div className={cn("mt-0.5 font-semibold leading-tight", muted ? "text-muted" : "text-fg")}>{name}</div>
      {sub && <div className="mt-0.5 text-xs leading-snug text-muted">{sub}</div>}
      {lockNote && <div className="mt-0.5 text-xs text-muted">{lockNote}</div>}
    </div>
  );
}

// ── GPS capture panel ────────────────────────────────────────────────
/** Good enough to trust without re-checking — matches the default site geofence. */
const GOOD_ACCURACY_M = 100;
/** Total GPS attempts before accepting whatever fix we have (or giving up). */
const MAX_ATTEMPTS = 3;

/** Plain haversine — kept local so this stays a client component with no server import. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Location capture built for someone who has never used a maps app before.
 *
 * No jargon: never shows "GPS", "coordinates", "accuracy" or a raw lat/lng —
 * only a plain address and a plain distance. A poor first fix is retried
 * automatically (silently, up to MAX_ATTEMPTS) rather than surfaced as an
 * error, and only PERMISSION_DENIED — which a retry cannot fix — stops early.
 */
function GpsCapture({
  employeeId, fromLat, fromLng, fromName, lang, onUse, onSaved,
}: {
  employeeId: string;
  /** Where today's trip is starting from, if known — for the "how far away" readout. */
  fromLat: number | null;
  fromLng: number | null;
  fromName: string | null;
  lang: Lang;
  onUse: (d: Dest) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "denied" | "error">("idle");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [detected, setDetected] = useState<{
    lat: number; lng: number; address: string; accuracy: number;
    city: string | null; state: string | null; country: string | null; postalCode: string | null;
  } | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function getOneFix(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 15000, maximumAge: 0,
      });
    });
  }

  async function locate() {
    setError(""); setDetected(null); setSaved(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError(t(lang, "browserNoGps"));
      return;
    }
    setStatus("working");

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      setAttempt(i);
      let pos: GeolocationPosition;
      try {
        pos = await getOneFix();
      } catch (err) {
        const e = err as GeolocationPositionError;
        if (e.code === e.PERMISSION_DENIED) { setStatus("denied"); return; }
        if (i < MAX_ATTEMPTS) continue; // transient miss — silently retry
        setStatus("error");
        setError(t(lang, "gpsUnavailable"));
        return;
      }

      const { latitude, longitude, accuracy } = pos.coords;
      // Good fix, or out of attempts — either way, stop here and use it.
      if (accuracy <= GOOD_ACCURACY_M || i === MAX_ATTEMPTS) {
        try {
          const g = await geocodeCoords(latitude, longitude);
          setDetected({
            lat: latitude, lng: longitude, address: g.address, accuracy,
            city: g.city, state: g.state, country: g.country, postalCode: g.postalCode,
          });
          setSaveName(g.area || g.city || t(lang, "newLocationDefault"));
          setStatus("done");
        } catch (e) {
          setStatus("error"); setError(errorMessage(e));
        }
        return;
      }
      // Otherwise: a fix came back, but it's not precise enough yet — loop
      // around for another attempt rather than accepting a rough guess.
    }
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

  const distanceFromOrigin =
    detected && fromLat != null && fromLng != null
      ? distanceKm({ lat: fromLat, lng: fromLng }, { lat: detected.lat, lng: detected.lng })
      : null;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LocateFixed className="h-4 w-4 text-brand" /> {t(lang, "gpsHeading")}
      </div>

      {status === "idle" && (
        <button type="button" onClick={locate} className="btn-primary w-full py-3.5 text-base">
          <LocateFixed className="h-5 w-5" /> {t(lang, "getMyLocation")}
        </button>
      )}

      {status === "working" && (
        <div className="flex flex-col items-center gap-2 py-3 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-brand" />
          <p className="text-sm font-medium">
            {attempt <= 1 ? t(lang, "findingLocation") : t(lang, "almostReady")}
          </p>
          <p className="text-xs text-muted">{t(lang, "pleaseWait")}</p>
        </div>
      )}

      {status === "denied" && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-600" />
          <p className="text-sm font-semibold">{t(lang, "allowPermissionTitle")}</p>
          <p className="text-sm text-muted">{t(lang, "allowPermissionBody")}</p>
          <button type="button" onClick={locate} className="btn-primary mt-1 w-full py-3">
            {t(lang, "getMyLocation")}
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-center">
          <AlertTriangle className="h-10 w-10 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={locate} className="btn-ghost mt-1 text-sm">{t(lang, "tryAgain")}</button>
        </div>
      )}

      {status === "done" && detected && (
        <div className="space-y-3">
          <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-semibold text-green-700">
              <Check className="h-4 w-4" /> {t(lang, "locationFound")}
            </div>
            <p className="mt-1.5 leading-snug">{detected.address}</p>
            {distanceFromOrigin != null && (
              <p className="mt-1 text-xs text-muted">
                {fromName ? `${fromName} · ` : ""}{distanceFromOrigin < 1
                  ? `${Math.round(distanceFromOrigin * 1000)} m ${t(lang, "awayFrom")}`
                  : `${distanceFromOrigin.toFixed(1)} km ${t(lang, "awayFrom")}`}
              </p>
            )}
            <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-green-700">
              <Check className="h-3 w-3" /> {t(lang, "locationVerified")}
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
            className="btn-primary w-full py-3.5 text-base"
          >
            <Check className="h-5 w-5" /> {t(lang, "confirmLocation")}
          </button>

          <div className="rounded-md border p-2">
            <p className="text-sm font-medium">{t(lang, "saveForNextTime")}</p>
            {saved ? (
              <p className="mt-1 text-sm text-green-600">{t(lang, "savedDone")}</p>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  aria-label={t(lang, "giveItAName")}
                  placeholder={t(lang, "giveItAName")}
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
                <button type="button" onClick={saveThis} disabled={saving} className="btn-ghost text-sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t(lang, "save")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
