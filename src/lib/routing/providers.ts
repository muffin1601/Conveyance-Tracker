import "server-only";

/**
 * The routing engines themselves. Each function does one thing: ask a provider
 * for a driving route and return metres and seconds, or null if it could not
 * answer. No caching, no fallback logic, no business rules — those belong to
 * the service that calls these.
 */

import { routingConfig, type RoutingConfig } from "./config";
import type { Coordinates } from "./types";

/** The narrow slice of each provider's payload this module actually reads. */
interface OsrmRouteResponse {
  code?: string;
  routes?: { distance: number; duration: number }[];
}
interface GoogleMatrixResponse {
  rows?: { elements?: { status?: string; distance?: { value: number }; duration?: { value: number } }[] }[];
}

export interface ProviderRoute {
  distanceMeters: number;
  durationSeconds: number;
}

async function fetchJson(url: URL, timeoutMs: number): Promise<unknown> {
  // AbortSignal.timeout aborts the socket too, so a stalled provider cannot
  // hold a connection (or a server action) open past the deadline.
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Routing provider responded ${res.status}`);
  return res.json();
}

/**
 * OSRM. Coordinates go in `longitude,latitude` order — the opposite of every
 * other coordinate in this codebase, and the single easiest thing to get wrong
 * here. `overview=false` drops the route geometry, which we do not store.
 *
 * Accepts two or more points: passing the day's stops in one request routes
 * *through* them, which is both more accurate and cheaper than one request per
 * pair.
 */
export async function routeViaOsrm(
  points: Coordinates[],
  config: RoutingConfig = routingConfig(),
): Promise<ProviderRoute | null> {
  if (points.length < 2) return null;
  const path = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const url = new URL(`${config.osrmBaseUrl}/route/v1/${config.profile}/${path}`);
  url.searchParams.set("overview", "false");

  const data = (await fetchJson(url, config.timeoutMs)) as OsrmRouteResponse;
  const route = data?.routes?.[0];
  if (data?.code !== "Ok" || !route) return null;
  return { distanceMeters: route.distance, durationSeconds: route.duration };
}

/**
 * Google Distance Matrix. Only reachable when a key is configured; kept because
 * the deployment may already have one, and it routes the same road network.
 */
export async function routeViaGoogle(
  origin: Coordinates,
  destination: Coordinates,
  config: RoutingConfig = routingConfig(),
): Promise<ProviderRoute | null> {
  if (!config.googleApiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${origin.latitude},${origin.longitude}`);
  url.searchParams.set("destinations", `${destination.latitude},${destination.longitude}`);
  url.searchParams.set("mode", config.profile);
  url.searchParams.set("key", config.googleApiKey);

  const data = (await fetchJson(url, config.timeoutMs)) as GoogleMatrixResponse;
  const el = data?.rows?.[0]?.elements?.[0];
  if (el?.status !== "OK" || !el.distance || !el.duration) return null;
  return { distanceMeters: el.distance.value, durationSeconds: el.duration.value };
}
