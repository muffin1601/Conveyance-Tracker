"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, LocateFixed, MapPin } from "lucide-react";
import {
  checkGpsFix, resolveGeofenceRadius, MAX_GPS_ACCURACY_M,
  type GpsFix, type LatLng,
} from "@/lib/gps";
import { cn } from "@/lib/utils";
import { t, type Lang } from "@/lib/i18n";

/**
 * Step 3 of the visit workflow: prove the employee is standing at the location
 * they picked.
 *
 * This component is the FRIENDLY half of the check — it gives immediate,
 * plain-language feedback so nobody submits a form only to be rejected. It is
 * not the enforcement: the server re-runs `checkGpsFix` against coordinates it
 * looks up itself before writing anything (see actions/visit.ts). The only
 * thing this component hands upwards is the raw device fix; there is no
 * "verified" flag for the server to take on trust.
 *
 * The vocabulary is deliberately non-technical: no latitude, no longitude, no
 * "geofence", no browser error codes.
 */

type Phase =
  | "idle"        // waiting for a destination / not started
  | "requesting"  // permission prompt is (or may be) on screen
  | "locating"    // fix in flight
  | "checking"    // fix in hand, measuring the distance
  | "verified"
  | "denied"
  | "outside"
  | "weak"
  | "unavailable"
  | "noCoords";

/**
 * How long to keep listening for a better reading before settling for the best
 * one seen. A phone's first fix is often a coarse network estimate that sharpens
 * to satellite accuracy within a few seconds, so a little patience turns a
 * "signal too weak" into a verified visit.
 */
const IMPROVE_WINDOW_MS = 10_000;
/** Absolute limit before giving up on getting any reading at all. */
const HARD_TIMEOUT_MS = 22_000;

interface Acquired {
  fix: GpsFix;
  /** Best accuracy seen so far, for the progress line. */
  accuracy: number;
}

type AcquireResult =
  | { ok: true; value: Acquired }
  | { ok: false; reason: "denied" | "unavailable" };

/**
 * Get the best reading the device can manage, within a bounded time.
 *
 * `watchPosition`, not repeated `getCurrentPosition`: a watch streams fixes as
 * they sharpen, so a good one is used the moment it arrives. Calling
 * `getCurrentPosition` in a loop with `maximumAge: 0` instead waits out a full
 * timeout per attempt — on a weak signal that left the employee watching a
 * spinner for the better part of a minute.
 */
function acquireFix(
  onProgress: (bestAccuracy: number) => void,
  signal: { cancelled: boolean },
): Promise<AcquireResult> {
  return new Promise<AcquireResult>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unavailable" });
      return;
    }

    let best: Acquired | null = null;
    let watchId: number | null = null;
    let improveTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const finish = (result: AcquireResult) => {
      if (done) return;
      done = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (improveTimer) clearTimeout(improveTimer);
      if (hardTimer) clearTimeout(hardTimer);
      resolve(result);
    };

    hardTimer = setTimeout(() => {
      finish(best ? { ok: true, value: best } : { ok: false, reason: "unavailable" });
    }, HARD_TIMEOUT_MS);

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (signal.cancelled) return finish({ ok: false, reason: "unavailable" });
        const candidate: Acquired = {
          fix: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturedAt: pos.timestamp,
          },
          accuracy: pos.coords.accuracy,
        };
        if (!best || candidate.accuracy < best.accuracy) best = candidate;
        onProgress(best.accuracy);

        // Good enough — no reason to keep the employee waiting.
        if (best.accuracy <= MAX_GPS_ACCURACY_M) {
          finish({ ok: true, value: best });
          return;
        }
        // Too coarse: give the receiver a chance to sharpen, then take the
        // best we got and let the rules judge it.
        if (!improveTimer) {
          improveTimer = setTimeout(() => {
            finish(best ? { ok: true, value: best } : { ok: false, reason: "unavailable" });
          }, IMPROVE_WINDOW_MS);
        }
      },
      (err) => {
        // A refusal is final; anything else may still resolve itself, so the
        // watch is left running until one of the timers fires.
        if (err && err.code === err.PERMISSION_DENIED) finish({ ok: false, reason: "denied" });
      },
      { enableHighAccuracy: true, timeout: HARD_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

function formatMetres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export interface VerifiedLocation {
  fix: GpsFix;
  distanceM: number;
}

export function VerifyLocation({
  lang, destinationName, target, locationRadius, companyRadius, disabled, onChange,
}: {
  lang: Lang;
  destinationName: string;
  /** The selected location's stored coordinates — null when it has none. */
  target: LatLng | null;
  /** The location's own geofence, when it has one (master sites do). */
  locationRadius: number | null;
  /** Company-wide default radius, from Settings. */
  companyRadius: number;
  /** True while the visit is being submitted — no re-checking mid-flight. */
  disabled?: boolean;
  onChange: (v: VerifiedLocation | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [distanceM, setDistanceM] = useState<number | null>(null);
  /** Guards against two overlapping checks (double tap, or auto-start + tap). */
  const running = useRef(false);
  /** Discards the result of a check whose destination has since changed. */
  const runSeq = useRef(0);
  /** Lets an in-flight acquisition be abandoned and its watch torn down. */
  const cancel = useRef<{ cancelled: boolean } | null>(null);

  const radiusM = resolveGeofenceRadius(locationRadius, companyRadius);
  const targetKey = target ? `${target.lat},${target.lng}` : "none";

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const verify = useCallback(async () => {
    if (running.current) return;
    const seq = ++runSeq.current;
    const settle = (next: Phase, dist: number | null, result: VerifiedLocation | null) => {
      if (seq !== runSeq.current) return; // superseded by a newer destination
      setPhase(next);
      setDistanceM(dist);
      onChangeRef.current(result);
    };

    onChangeRef.current(null);
    setDistanceM(null);

    if (!target) { settle("noCoords", null, null); return; }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      settle("unavailable", null, null);
      return;
    }

    running.current = true;
    setPhase("requesting");
    const cancelSignal = { cancelled: false };
    cancel.current = cancelSignal;
    try {
      const result = await acquireFix(
        // The first reading arriving means permission is granted and the
        // receiver is talking — move the status on from "asking".
        () => { if (seq === runSeq.current) setPhase("locating"); },
        cancelSignal,
      );
      if (seq !== runSeq.current || cancelSignal.cancelled) return;

      if (!result.ok) {
        settle(result.reason === "denied" ? "denied" : "unavailable", null, null);
        return;
      }

      setPhase("checking");
      const fix = result.value.fix;
      const check = checkGpsFix(fix, target, radiusM);
      if (check.code === "OK") {
        settle("verified", check.distanceM, { fix, distanceM: check.distanceM });
      } else if (check.code === "OUT_OF_RANGE") {
        settle("outside", check.distanceM, null);
      } else if (check.code === "POOR_ACCURACY") {
        settle("weak", null, null);
      } else if (check.code === "NO_TARGET_COORDS") {
        settle("noCoords", null, null);
      } else {
        settle("unavailable", null, null);
      }
    } finally {
      running.current = false;
    }
  }, [radiusM, target]);

  // A new destination invalidates any previous verification immediately, then
  // the check starts on its own — one less tap for someone who is already
  // standing at the site. Keyed on the coordinates, not the object identity,
  // so an unrelated re-render never re-triggers it.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    runSeq.current++;
    running.current = false;
    // Abandon any watch still running for the previous destination.
    if (cancel.current) cancel.current.cancelled = true;
    setDistanceM(null);
    onChangeRef.current(null);
    if (!target) { setPhase("noCoords"); return; }
    setPhase("idle");
    /* eslint-enable react-hooks/set-state-in-effect */
    void verify();
    return () => { if (cancel.current) cancel.current.cancelled = true; };
    // `verify` is recreated whenever the target changes, which is exactly when
    // this should re-run; `target` itself is covered by targetKey.
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = phase === "requesting" || phase === "locating" || phase === "checking";

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        phase === "verified" && "border-green-500/40 bg-green-500/5",
        (phase === "outside" || phase === "denied" || phase === "noCoords") && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <LocateFixed className="h-4 w-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 break-words">{t(lang, "stepVerify")}</span>
      </div>
      <p className="mt-1 text-xs leading-snug text-muted">{t(lang, "verifyIntro")}</p>

      <div className="mt-3">
        {busy && (
          <div className="flex items-center gap-2.5 text-sm">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand" />
            <span className="min-w-0">
              {phase === "requesting"
                ? t(lang, "gpsRequesting")
                : phase === "checking"
                  ? t(lang, "gpsChecking")
                  : t(lang, "gpsGetting")}
            </span>
          </div>
        )}

        {phase === "idle" && (
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <MapPin className="h-5 w-5 shrink-0" />
            <span>{t(lang, "gpsWaiting")}</span>
          </div>
        )}

        {phase === "verified" && (
          <div className="flex items-start gap-2.5 text-sm">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            <div className="min-w-0">
              <div className="font-semibold text-green-700">{t(lang, "gpsVerified")}</div>
              {distanceM != null && (
                <div className="text-xs text-muted">
                  {t(lang, "gpsVerifiedDetail", {
                    distance: formatMetres(distanceM),
                    name: destinationName,
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "outside" && (
          <Problem
            title={t(lang, "gpsOutsideArea")}
            body={t(lang, "gpsOutsideAreaBody", { name: destinationName })}
            detail={
              distanceM != null
                ? t(lang, "gpsOutsideAreaDetail", {
                    distance: formatMetres(distanceM),
                    radius: formatMetres(radiusM),
                  })
                : undefined
            }
          />
        )}

        {phase === "denied" && (
          <Problem
            title={t(lang, "gpsPermissionRequired")}
            body={t(lang, "gpsPermissionRequiredBody")}
          />
        )}

        {phase === "weak" && (
          <Problem title={t(lang, "gpsWeakSignal")} body={t(lang, "gpsWeakSignalBody")} />
        )}

        {phase === "unavailable" && (
          <Problem title={t(lang, "gpsUnavailable")} body={t(lang, "allowPermissionBody")} />
        )}

        {phase === "noCoords" && (
          <Problem title={t(lang, "gpsNoCoordsForLocation")} body="" />
        )}
      </div>

      {phase !== "noCoords" && (
        <button
          type="button"
          onClick={() => void verify()}
          disabled={busy || disabled}
          className={cn(
            "mt-3 w-full py-3 text-base",
            phase === "verified" ? "btn-ghost" : "btn-primary",
          )}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LocateFixed className="h-5 w-5" />}
          {phase === "denied"
            ? t(lang, "enableLocation")
            : phase === "idle"
              ? t(lang, "checkMyLocation")
              : t(lang, "checkAgain")}
        </button>
      )}
    </div>
  );
}

function Problem({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <div className="font-semibold text-amber-700">{title}</div>
        {body && <p className="mt-0.5 leading-snug text-muted">{body}</p>}
        {detail && <p className="mt-0.5 text-xs tabular-nums text-muted">{detail}</p>}
      </div>
    </div>
  );
}
