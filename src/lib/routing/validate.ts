/**
 * What must be true before a routing request is worth making.
 *
 * A routing engine will happily answer for nonsense coordinates — Null Island,
 * a swapped lat/lng pair, a fix that jumped continents — and the answer will be
 * a plausible-looking number that ends up on somebody's reimbursement. Every
 * rejection here is a request that never leaves the server.
 */

import { haversineMeters, isValidCoord } from "../gps";
import type { Coordinates, RouteRejection } from "./types";

/**
 * Under 50 m apart is "no travel": inside the noise of a consumer GPS fix, and
 * the same threshold the visit form uses to refuse a leg to where you already
 * are (see `isSamePlace` in actions/visit.ts).
 */
export const SAME_POINT_METERS = 50;

/**
 * A single leg longer than this is not a day trip in this business — it is a
 * bad fix, a swapped coordinate pair, or a stale reading from another city.
 * Routing it would turn that error into money.
 */
export const MAX_LEG_KM = 2000;

export interface ValidationOk { ok: true }
export interface ValidationFailed { ok: false; reason: RouteRejection; straightLineKm: number }
export type Validation = ValidationOk | ValidationFailed;

export function toLatLng(c: Coordinates) {
  return { lat: c.latitude, lng: c.longitude };
}

export function validateRouteRequest(origin: Coordinates, destination: Coordinates): Validation {
  const straightLineKm = haversineMeters(toLatLng(origin), toLatLng(destination)) / 1000;

  if (!isValidCoord(origin.latitude, origin.longitude)) {
    return { ok: false, reason: "INVALID_ORIGIN", straightLineKm: 0 };
  }
  if (!isValidCoord(destination.latitude, destination.longitude)) {
    return { ok: false, reason: "INVALID_DESTINATION", straightLineKm: 0 };
  }
  if (straightLineKm * 1000 < SAME_POINT_METERS) {
    return { ok: false, reason: "SAME_POINT", straightLineKm };
  }
  if (straightLineKm > MAX_LEG_KM) {
    return { ok: false, reason: "IMPLAUSIBLE_DISTANCE", straightLineKm };
  }
  return { ok: true };
}
