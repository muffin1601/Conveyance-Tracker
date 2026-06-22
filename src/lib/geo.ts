import { prisma } from "./prisma";

export interface LatLng {
  lat: number;
  lng: number;
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
  source: "GOOGLE" | "HAVERSINE" | "CACHE";
}

function cacheKey(a: LatLng, b: LatLng): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(a.lat)},${r(a.lng)}|${r(b.lat)},${r(b.lng)}`;
}

/**
 * The Distance Calculation Engine.
 * Resolution order: cache → Google Distance Matrix (if key set) → Haversine.
 * Results from Google are persisted so a route is never billed twice.
 */
export async function computeDistance(
  a: LatLng,
  b: LatLng,
): Promise<DistanceResult> {
  const haversineKm = haversineMeters(a, b) / 1000;

  // Same point (or sub-50m): no travel.
  if (haversineKm < 0.05) {
    return { distanceKm: 0, roadKm: 0, haversineKm: 0, durationMin: 0, source: "HAVERSINE" };
  }

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

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      url.searchParams.set("origins", `${a.lat},${a.lng}`);
      url.searchParams.set("destinations", `${b.lat},${b.lng}`);
      url.searchParams.set("mode", "driving");
      url.searchParams.set("key", apiKey);
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      const el = data?.rows?.[0]?.elements?.[0];
      if (el?.status === "OK") {
        const roadKm = el.distance.value / 1000;
        const durationMin = Math.round(el.duration.value / 60);
        await prisma.distanceCache.create({
          data: { key, roadKm, haversineKm, durationMin, source: "GOOGLE" },
        });
        return { distanceKm: roadKm, roadKm, haversineKm, durationMin, source: "GOOGLE" };
      }
    } catch {
      // fall through to Haversine
    }
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
