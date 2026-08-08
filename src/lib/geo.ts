import { prisma } from "./prisma";
import { memo } from "./cache";
import { haversineMeters, type LatLng } from "./gps";

// The geometry itself lives in lib/gps.ts, which is import-safe from client
// components (this module pulls in Prisma). Re-exported so existing server
// callers keep importing it from here.
export { haversineMeters };
export type { LatLng };

/**
 * Road distance estimate. Straight-line distance is inflated by a road factor
 * (urban driving is rarely point-to-point). Calibrated to ~1.3 for Indian
 * metro road networks.
 */
const ROAD_FACTOR = 1.3;
const URBAN_SPEED_KMH = 24; // average city speed incl. traffic

export interface DistanceResult {
  distanceKm: number; // chosen distance used for reimbursement
  roadKm: number | null;
  haversineKm: number;
  durationMin: number;
  source: "GOOGLE" | "OSRM" | "HAVERSINE" | "CACHE";
}

function cacheKey(a: LatLng, b: LatLng): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(a.lat)},${r(a.lng)}|${r(b.lat)},${r(b.lng)}`;
}

/**
 * Both external providers are public HTTP endpoints with no SLA. Without a
 * deadline a stalled OSRM request would hold the whole server action open
 * (Node's default has no timeout), which is exactly what made the live fare
 * preview feel frozen. 4 s is generous for a single matrix lookup; past that
 * the road-factor fallback is the better answer.
 */
const PROVIDER_TIMEOUT_MS = 4000;

/** The narrow slice of each provider's payload this module actually reads. */
interface GoogleMatrixResponse {
  rows?: { elements?: { status?: string; distance?: { value: number }; duration?: { value: number } }[] }[];
}
interface OsrmRouteResponse {
  code?: string;
  routes?: { distance: number; duration: number }[];
}

async function fetchJson(url: URL): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Provider responded ${res.status}`);
  return res.json();
}

/** Coordinates rounded to the cache's 5-dp precision, both directions equal. */
function memoKey(a: LatLng, b: LatLng): string {
  return `distance:${cacheKey(a, b)}`;
}

/**
 * The Distance Calculation Engine.
 * Resolution order: in-process memo → DistanceCache row → Google Distance
 * Matrix (if key set) → OSRM → road-factor Haversine. Provider results are
 * persisted so a route is never paid for twice.
 *
 * The in-process memo (10 min) matters because the fare preview re-runs as the
 * user changes mode/fare, and every DistanceCache lookup is a ~450 ms hop.
 */
export async function computeDistance(a: LatLng, b: LatLng): Promise<DistanceResult> {
  const haversineKm = haversineMeters(a, b) / 1000;
  // Sub-50 m is "no travel" — answer without touching the network or the DB.
  if (haversineKm < 0.05) {
    return { distanceKm: 0, roadKm: 0, haversineKm: 0, durationMin: 0, source: "HAVERSINE" };
  }
  return memo(memoKey(a, b), 10 * 60_000, () => resolveDistance(a, b, haversineKm));
}

async function resolveDistance(
  a: LatLng,
  b: LatLng,
  haversineKm: number,
): Promise<DistanceResult> {
  const key = cacheKey(a, b);
  const cached = await prisma.distanceCache.findUnique({ where: { key } });
  if (cached) {
    return {
      distanceKm: cached.roadKm,
      roadKm: cached.roadKm,
      haversineKm: cached.haversineKm,
      durationMin: cached.durationMin,
      source: "CACHE",
    };
  }

  /**
   * Persist a freshly-resolved route without making the caller wait for the
   * insert (another ~450 ms). `skipDuplicates` absorbs the race where two
   * users resolve the same leg at the same moment.
   */
  const persist = (roadKm: number, durationMin: number, source: string) => {
    void prisma.distanceCache
      .createMany({ data: [{ key, roadKm, haversineKm, durationMin, source }], skipDuplicates: true })
      .catch(() => {}); // caching is best-effort; never fail a visit over it
  };

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      url.searchParams.set("origins", `${a.lat},${a.lng}`);
      url.searchParams.set("destinations", `${b.lat},${b.lng}`);
      url.searchParams.set("mode", "driving");
      url.searchParams.set("key", apiKey);
      const data = (await fetchJson(url)) as GoogleMatrixResponse;
      const el = data?.rows?.[0]?.elements?.[0];
      if (el?.status === "OK" && el.distance && el.duration) {
        const roadKm = el.distance.value / 1000;
        const durationMin = Math.round(el.duration.value / 60);
        persist(roadKm, durationMin, "GOOGLE");
        return { distanceKm: roadKm, roadKm, haversineKm, durationMin, source: "GOOGLE" };
      }
    } catch {
      // fall through to the next provider
    }
  }

  // Free provider: OSRM public routing (no key). Tried when Google is not
  // configured (or fails). Results are cached like Google's so a route is
  // resolved at most once.
  try {
    const osrm = new URL(
      `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}`,
    );
    osrm.searchParams.set("overview", "false");
    const data = (await fetchJson(osrm)) as OsrmRouteResponse;
    const route = data?.routes?.[0];
    if (data?.code === "Ok" && route) {
      const roadKm = +(route.distance / 1000).toFixed(2);
      const durationMin = Math.round(route.duration / 60);
      persist(roadKm, durationMin, "OSRM");
      return { distanceKm: roadKm, roadKm, haversineKm, durationMin, source: "OSRM" };
    }
  } catch {
    // fall through to Haversine
  }

  // Fallback: road-factor adjusted Haversine.
  const roadKm = +(haversineKm * ROAD_FACTOR).toFixed(2);
  const durationMin = Math.round((roadKm / URBAN_SPEED_KMH) * 60);
  return { distanceKm: roadKm, roadKm, haversineKm, durationMin, source: "HAVERSINE" };
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
