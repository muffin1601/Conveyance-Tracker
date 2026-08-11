import "server-only";

/**
 * The Road Distance Service — the one place a journey's distance is decided.
 *
 * Resolution order, highest confidence first:
 *   1. in-process memo    (10 min; the fare preview re-runs on every keystroke)
 *   2. DistanceCache row  (a route already measured, replayed for free)
 *   3. the configured routing provider — OSRM, or Google if a key is set
 *   4. straight line × road factor — an ESTIMATE, and labelled as one
 *
 * Step 4 exists so a provider outage can never block an employee from logging
 * a visit. It is never presented as a road distance: the result carries
 * `source: "HAVERSINE"` and `routeAvailable: false` all the way to the admin
 * table and the CSV export, and scripts/backfill-road-distance.ts can upgrade
 * those legs once routing is reachable again.
 */

import { prisma } from "../prisma";
import { memo } from "../cache";
import { haversineMeters } from "../gps";
import { routingConfig } from "./config";
import { routeViaGoogle, routeViaOsrm, type ProviderRoute } from "./providers";
import { SAME_POINT_METERS, toLatLng, validateRouteRequest } from "./validate";
import type { Coordinates, DistanceSource, RouteResult } from "./types";

export * from "./types";
export { validateRouteRequest, MAX_LEG_KM, SAME_POINT_METERS } from "./validate";
export { routingConfig } from "./config";

/**
 * Urban driving is never point-to-point. 1.3 is calibrated to Indian metro
 * road networks and is only ever applied to the fallback estimate — a real
 * routed distance is never scaled.
 */
const ROAD_FACTOR = 1.3;
/** Average city speed including traffic, for estimating fallback duration. */
const URBAN_SPEED_KMH = 24;

/** 5 dp ≈ 1.1 m: precise enough that two fixes at one doorway share a route. */
const CACHE_PRECISION = 5;

const MEMO_TTL_MS = 10 * 60_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cache key. Direction is part of it on purpose — one-way systems and
 * divided highways make A→B and B→A genuinely different distances.
 */
export function routeCacheKey(origin: Coordinates, destination: Coordinates): string {
  const r = (n: number) => n.toFixed(CACHE_PRECISION);
  return `${r(origin.latitude)},${r(origin.longitude)}|${r(destination.latitude)},${r(destination.longitude)}`;
}

function toResult(route: ProviderRoute, source: DistanceSource): RouteResult {
  return {
    distanceMeters: Math.round(route.distanceMeters),
    distanceKm: round2(route.distanceMeters / 1000),
    durationSeconds: Math.round(route.durationSeconds),
    routeAvailable: true,
    source,
  };
}

/** The labelled estimate used when no provider could answer. */
function estimate(straightLineKm: number): RouteResult {
  const km = round2(straightLineKm * ROAD_FACTOR);
  return {
    distanceMeters: Math.round(km * 1000),
    distanceKm: km,
    durationSeconds: Math.round((km / URBAN_SPEED_KMH) * 3600),
    routeAvailable: false,
    source: "HAVERSINE",
  };
}

const ZERO: RouteResult = {
  distanceMeters: 0, distanceKm: 0, durationSeconds: 0, routeAvailable: true, source: "OSRM",
};

/**
 * Road distance between two points. This is the function the rest of the
 * application calls; nothing else may talk to a routing provider directly.
 */
export async function calculateRoadDistance(input: {
  origin: Coordinates;
  destination: Coordinates;
}): Promise<RouteResult> {
  const { origin, destination } = input;
  const check = validateRouteRequest(origin, destination);

  if (!check.ok) {
    // Standing still is a real, valid answer of zero — not a failure, and not
    // worth a network call or a cache row.
    if (check.reason === "SAME_POINT") return { ...ZERO, source: "OSRM" };
    // Anything else is bad data. Return the straight line, clearly marked, and
    // never let a nonsense coordinate reach a provider.
    return estimate(check.straightLineKm);
  }

  return memo(`route:${routeCacheKey(origin, destination)}`, MEMO_TTL_MS, () =>
    resolveRoute(origin, destination),
  );
}

async function resolveRoute(origin: Coordinates, destination: Coordinates): Promise<RouteResult> {
  const key = routeCacheKey(origin, destination);
  const straightLineKm = haversineMeters(toLatLng(origin), toLatLng(destination)) / 1000;

  const cached = await prisma.distanceCache.findUnique({ where: { key } }).catch(() => null);
  if (cached) {
    return {
      distanceMeters: Math.round(cached.roadKm * 1000),
      distanceKm: cached.roadKm,
      durationSeconds: cached.durationMin * 60,
      routeAvailable: true,
      source: "CACHE",
    };
  }

  /**
   * Persist a freshly-resolved route without making the caller wait for the
   * insert. `skipDuplicates` absorbs the race where two employees resolve the
   * same leg at the same moment.
   */
  const persist = (result: RouteResult) => {
    void prisma.distanceCache
      .createMany({
        data: [{
          key,
          roadKm: result.distanceKm,
          haversineKm: round2(straightLineKm),
          durationMin: Math.round(result.durationSeconds / 60),
          source: result.source,
        }],
        skipDuplicates: true,
      })
      .catch(() => {}); // caching is best-effort; never fail a visit over it
  };

  const config = routingConfig();
  // Providers are tried in order and the first real answer wins. A provider
  // that throws (timeout, DNS, 5xx) or answers "no route" falls through to the
  // next one rather than failing the visit.
  const attempts: [DistanceSource, () => Promise<ProviderRoute | null>][] =
    config.provider === "google"
      ? [["GOOGLE", () => routeViaGoogle(origin, destination, config)],
         ["OSRM", () => routeViaOsrm([origin, destination], config)]]
      : config.provider === "osrm"
        ? [["OSRM", () => routeViaOsrm([origin, destination], config)]]
        : [];

  for (const [source, run] of attempts) {
    try {
      const route = await run();
      if (route && Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0) {
        const result = toResult(route, source);
        persist(result);
        return result;
      }
    } catch {
      // Try the next provider; the estimate below is the last resort.
    }
  }

  // Deliberately NOT persisted: an estimate must never be replayed from cache
  // as though it were a measured route, and the next attempt should try the
  // provider again.
  return estimate(straightLineKm);
}

/**
 * Road distance through an ordered list of stops, in ONE provider request.
 *
 * A day's travel is A→B→C→D, and routing each leg separately is both four
 * requests and four chances to fall back. This is here for callers that hold
 * the whole sequence; per-leg storage still happens leg by leg, so nothing
 * double-counts (see the note in actions/visit.ts).
 */
export async function calculateRouteThrough(points: Coordinates[]): Promise<RouteResult> {
  if (points.length < 2) return ZERO;
  if (points.length === 2) {
    return calculateRoadDistance({ origin: points[0], destination: points[1] });
  }

  // Drop consecutive duplicates: a stationary employee produces repeated fixes,
  // and a zero-length hop adds nothing but a waypoint the router must snap.
  const meaningful = points.filter((p, i) =>
    i === 0 || haversineMeters(toLatLng(points[i - 1]), toLatLng(p)) >= SAME_POINT_METERS,
  );
  if (meaningful.length < 2) return ZERO;

  const straightLineKm =
    meaningful.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + haversineMeters(toLatLng(meaningful[i - 1]), toLatLng(p))),
      0,
    ) / 1000;

  const config = routingConfig();
  if (config.provider !== "none") {
    try {
      const route = await routeViaOsrm(meaningful, config);
      if (route) return toResult(route, "OSRM");
    } catch {
      // fall through to the estimate
    }
  }
  return estimate(straightLineKm);
}
