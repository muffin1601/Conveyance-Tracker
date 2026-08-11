/**
 * The routing contract, shared by every provider and every caller.
 *
 * Deliberately dependency-free (no Prisma, no `server-only`) so the types can
 * be imported from client components that only need to *label* a distance.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Where a distance came from. This is not decoration — a reimbursement figure
 * derived from a straight line is a different kind of number from one measured
 * along the road network, and every screen and export says which it is.
 *
 *   OSRM      routed over the real road network (the intended path)
 *   CACHE     a previously routed result, replayed from DistanceCache
 *   GOOGLE    routed by Google Distance Matrix, if a key is configured
 *   HAVERSINE straight line × a road factor — an ESTIMATE, used only when
 *             every routing provider was unreachable
 *   MANUAL    typed in by the employee; not measured at all
 */
export type DistanceSource = "OSRM" | "CACHE" | "GOOGLE" | "HAVERSINE" | "MANUAL";

/** The sources that represent a real measured road route. */
const ROAD_SOURCES: ReadonlySet<string> = new Set<DistanceSource>(["OSRM", "CACHE", "GOOGLE"]);

/**
 * True when the distance was measured along roads. Drives the "Road distance"
 * vs "Estimated" wording; the one place that decision is made.
 */
export function isRoadDistance(source: string): boolean {
  return ROAD_SOURCES.has(source);
}

/** Short human label for a distance source, used in tables and exports. */
export function distanceSourceLabel(source: string): string {
  switch (source) {
    case "OSRM":
    case "CACHE":
    case "GOOGLE":
      return "Road distance";
    case "HAVERSINE":
      return "Estimated";
    case "MANUAL":
      return "Entered by hand";
    default:
      return source;
  }
}

export interface RouteResult {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  /** False when no provider could route it and the figure is an estimate. */
  routeAvailable: boolean;
  source: DistanceSource;
}

/** Why a routing request was refused before any network call was made. */
export type RouteRejection =
  | "INVALID_ORIGIN"
  | "INVALID_DESTINATION"
  | "SAME_POINT"
  | "IMPLAUSIBLE_DISTANCE";
