/**
 * GPS verification rules — the single source of truth for "is this person
 * actually standing at that location?".
 *
 * Deliberately dependency-free and side-effect-free so the SAME code runs in
 * the browser (to show live status before the user submits) and on the server
 * (which re-runs it and is the only decision that counts). Nothing here may
 * import Prisma or `server-only` — see lib/geo.ts, which re-exports the
 * geometry helpers for server callers that already import from there.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A single browser geolocation reading, as it travels to the server. */
export interface GpsFix {
  lat: number;
  lng: number;
  /** Radius of the device's own confidence circle, in metres. */
  accuracy: number;
  /** `GeolocationPosition.timestamp` — epoch ms. */
  capturedAt: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres between two coordinates. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // Null Island is what a zeroed/spoofed payload looks like, never a real fix.
    !(lat === 0 && lng === 0)
  );
}

// ── Geofence radius ────────────────────────────────────────────────────
//
// Radius is configured in exactly two places and nowhere else:
//   1. Site.geofenceRadius — per master location (Settings → Locations).
//   2. CompanySettings.geofenceRadius — the company-wide default, used for
//      saved/ad-hoc locations which have no radius of their own, and as the
//      fallback whenever a site's value is missing or out of range.
// Every consumer goes through resolveGeofenceRadius so those two values are
// the only knobs that exist.

export const MIN_GEOFENCE_RADIUS_M = 50;
export const MAX_GEOFENCE_RADIUS_M = 5000;
/** Last-resort default, matching Site.geofenceRadius's schema default. */
export const FALLBACK_GEOFENCE_RADIUS_M = 200;

export function clampRadius(meters: number | null | undefined): number {
  if (typeof meters !== "number" || !Number.isFinite(meters)) {
    return FALLBACK_GEOFENCE_RADIUS_M;
  }
  return Math.min(MAX_GEOFENCE_RADIUS_M, Math.max(MIN_GEOFENCE_RADIUS_M, Math.round(meters)));
}

/**
 * The allowed radius for one destination: the location's own geofence when it
 * has one, otherwise the company-wide default.
 */
export function resolveGeofenceRadius(
  locationRadius: number | null | undefined,
  companyDefault: number | null | undefined,
): number {
  if (typeof locationRadius === "number" && Number.isFinite(locationRadius)) {
    return clampRadius(locationRadius);
  }
  return clampRadius(companyDefault);
}

// ── Fix quality ────────────────────────────────────────────────────────

/**
 * Worst device-reported accuracy still treated as a real fix. Beyond this the
 * reading is a coarse network/Wi-Fi estimate that can sit whole kilometres from
 * the phone, so "within 200 m of the site" would mean nothing.
 */
export const MAX_GPS_ACCURACY_M = 200;

/**
 * How long before the visit was created the fix may have been taken. This is
 * measured against the VISIT's own timestamp, not against the server clock —
 * a visit logged in a basement with no signal may not reach the server for
 * hours, and rejecting it then would punish the employee for the network.
 * Replay protection comes from the idempotency key instead (see
 * Journey.clientVisitId), which is a far stronger guarantee than a clock.
 */
export const GPS_FIX_MAX_AGE_MS = 10 * 60_000;
/** Matching tolerance for a device clock that runs ahead. */
export const GPS_FIX_MAX_SKEW_MS = 5 * 60_000;
/**
 * How long a queued offline visit stays syncable. Long enough for a phone to
 * spend a week off the network, short enough that a visit cannot be surfaced
 * months later against a changed roster or rate card.
 */
export const VISIT_MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60_000;

export type GpsCheckCode =
  | "OK"
  | "NO_TARGET_COORDS"
  | "INVALID_FIX"
  | "POOR_ACCURACY"
  | "STALE_FIX"
  | "EXPIRED_VISIT"
  | "OUT_OF_RANGE";

export type GpsCheck =
  | { code: "OK"; distanceM: number; radiusM: number; accuracyM: number }
  | { code: Exclude<GpsCheckCode, "OK">; distanceM: number | null; radiusM: number };

export interface GpsCheckOptions {
  /**
   * When the visit itself was created on the device. The fix is judged fresh
   * relative to THIS, so an offline visit that syncs hours later is still
   * valid — it was verified at the moment it was made. Defaults to `now`,
   * which is the online case.
   */
  visitAt?: number;
  /** Injectable clock, for tests. */
  now?: number;
}

/**
 * The whole rule, in one pure function: a fix is accepted only when it is a
 * real, sufficiently precise reading, taken moments before the visit it
 * authorises, inside the destination's radius. Callers get the measured
 * distance back so it can be stored.
 */
export function checkGpsFix(
  fix: GpsFix,
  target: LatLng | null,
  radiusM: number,
  options: GpsCheckOptions = {},
): GpsCheck {
  const radius = clampRadius(radiusM);
  const now = options.now ?? Date.now();
  const visitAt = options.visitAt ?? now;

  if (!target || !isValidCoord(target.lat, target.lng)) {
    return { code: "NO_TARGET_COORDS", distanceM: null, radiusM: radius };
  }
  if (!isValidCoord(fix.lat, fix.lng) || !Number.isFinite(fix.accuracy) || fix.accuracy <= 0) {
    return { code: "INVALID_FIX", distanceM: null, radiusM: radius };
  }
  if (fix.accuracy > MAX_GPS_ACCURACY_M) {
    return { code: "POOR_ACCURACY", distanceM: null, radiusM: radius };
  }
  // The visit may be queued, but it cannot be from the future, and it cannot
  // be so old that syncing it would rewrite settled history.
  if (
    !Number.isFinite(visitAt) ||
    visitAt > now + GPS_FIX_MAX_SKEW_MS ||
    visitAt < now - VISIT_MAX_QUEUE_AGE_MS
  ) {
    return { code: "EXPIRED_VISIT", distanceM: null, radiusM: radius };
  }
  // The reading must belong to the visit — taken just before it, not dug out
  // of an old session and attached to a new one.
  if (
    !Number.isFinite(fix.capturedAt) ||
    fix.capturedAt < visitAt - GPS_FIX_MAX_AGE_MS ||
    fix.capturedAt > visitAt + GPS_FIX_MAX_SKEW_MS
  ) {
    return { code: "STALE_FIX", distanceM: null, radiusM: radius };
  }

  const distanceM = Math.round(haversineMeters({ lat: fix.lat, lng: fix.lng }, target));
  if (distanceM > radius) {
    return { code: "OUT_OF_RANGE", distanceM, radiusM: radius };
  }
  return { code: "OK", distanceM, radiusM: radius, accuracyM: Math.round(fix.accuracy) };
}
