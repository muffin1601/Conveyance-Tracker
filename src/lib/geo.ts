import { haversineMeters, type LatLng } from "./gps";
import { calculateRoadDistance, type DistanceSource } from "./routing";

// The geometry itself lives in lib/gps.ts, which is import-safe from client
// components (this module pulls in Prisma). Re-exported so existing server
// callers keep importing it from here.
export { haversineMeters };
export type { LatLng };

export interface DistanceResult {
  /** The authoritative distance for this leg — what reimbursement is based on. */
  distanceKm: number;
  roadKm: number | null;
  haversineKm: number;
  durationMin: number;
  source: DistanceSource;
  /**
   * False when no routing provider could be reached and `distanceKm` is a
   * straight-line estimate rather than a measured road route. Callers must
   * surface this rather than passing the number off as a road distance.
   */
  routeAvailable: boolean;
}

/**
 * The Distance Calculation Engine — a thin adapter over lib/routing.
 *
 * The routing service owns provider selection, caching, validation and the
 * fallback rules; this keeps the `{ lat, lng }` shape and the `DistanceResult`
 * fields that visit/journey actions and the DistanceCache columns already use,
 * so there is exactly one distance for a leg no matter which caller asked.
 */
export async function computeDistance(a: LatLng, b: LatLng): Promise<DistanceResult> {
  const haversineKm = haversineMeters(a, b) / 1000;
  const route = await calculateRoadDistance({
    origin: { latitude: a.lat, longitude: a.lng },
    destination: { latitude: b.lat, longitude: b.lng },
  });
  return {
    distanceKm: route.distanceKm,
    roadKm: route.routeAvailable ? route.distanceKm : null,
    haversineKm: Math.round(haversineKm * 100) / 100,
    durationMin: Math.round(route.durationSeconds / 60),
    source: route.source,
    routeAvailable: route.routeAvailable,
  };
}

/** GPS proximity check used to authorise a punch. */
export function isWithinGeofence(
  current: LatLng,
  site: LatLng,
  radiusMeters: number,
): { ok: boolean; distance: number } {
  const distance = haversineMeters(current, site);
  return { ok: distance <= radiusMeters, distance };
}
