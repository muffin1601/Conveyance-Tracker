import "server-only";

/**
 * Routing configuration, read once from the environment.
 *
 * The provider is deliberately swappable: the public OSRM demo server is fine
 * for the volume this app generates today, but it has no SLA and no support
 * for production traffic. Moving to a self-hosted OSRM (or any other engine)
 * must be an env change, not a code change — which is why no module outside
 * this folder is allowed to know a provider name or a URL.
 */

export type RoutingProvider = "osrm" | "google" | "none";

export interface RoutingConfig {
  provider: RoutingProvider;
  osrmBaseUrl: string;
  /** Set only when Google is configured; never logged, never sent to a client. */
  googleApiKey: string | null;
  /** Routing profile. OSRM's public server only serves `driving`. */
  profile: "driving";
  timeoutMs: number;
}

const DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org";

/**
 * Both providers are public HTTP endpoints with no SLA. Without a deadline a
 * stalled request would hold a server action open (Node's fetch has no default
 * timeout), which is what used to make the live fare preview feel frozen.
 * 4 s is generous for a single route; past that the estimate is the better
 * answer than a spinner.
 */
const DEFAULT_TIMEOUT_MS = 4000;

export function routingConfig(): RoutingConfig {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
  const configured = process.env.ROUTING_PROVIDER?.trim().toLowerCase();

  // Unset means "decide from what is available", which keeps every existing
  // deployment working with no new env vars: a Google key wins if one is set,
  // otherwise OSRM. An explicit value always wins over that inference.
  const provider: RoutingProvider =
    configured === "osrm" || configured === "google" || configured === "none"
      ? configured
      : googleApiKey
        ? "google"
        : "osrm";

  return {
    provider,
    osrmBaseUrl: (process.env.OSRM_BASE_URL?.trim() || DEFAULT_OSRM_BASE_URL).replace(/\/+$/, ""),
    googleApiKey,
    profile: "driving",
    timeoutMs: Number(process.env.ROUTING_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}
