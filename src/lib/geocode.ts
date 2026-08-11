import "server-only";

// Coordinate validation is shared with the GPS verification rules (lib/gps.ts)
// so the client and the server can never disagree about what a valid point is.
import { isValidCoord } from "./gps";
export { isValidCoord };

// Naming lives in its own module so the offline backfill can reuse it verbatim.
import { parsePlace, placeLabel } from "./placeLabel";
export { placeLabel };

/**
 * Reverse-geocoding via OpenStreetMap Nominatim (no API key required).
 * Used to turn raw GPS coordinates into a human address when an employee
 * travels to a location that isn't in the Site master list.
 *
 * Nominatim's usage policy asks for a descriptive User-Agent and light,
 * server-side use — both satisfied here (calls only happen when a user taps
 * "Use Current Location"). If it fails, callers fall back to raw coordinates.
 */

export interface GeocodeResult {
  address: string;
  /** The most specific named place around the fix — locality, then road. */
  area: string | null;
  /**
   * The short human name for this point ("Kirti Nagar, New Delhi"). Built here
   * so every caller labels a GPS point the same way — see `placeLabel`.
   */
  label: string;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
}

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const UA = "WatconConveyanceTracker/1.0 (report@watcon.net)";
/** Nominatim asks for light use; a stalled lookup must not hang the form. */
const GEOCODE_TIMEOUT_MS = 8000;

/** Reverse-geocode coordinates. Throws on invalid coords or provider failure. */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  if (!isValidCoord(lat, lng)) throw new Error("Invalid coordinates.");

  const url = new URL(NOMINATIM);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  let data: {
    display_name?: string;
    address?: Record<string, string>;
  };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
    data = await res.json();
  } catch {
    throw new Error("Could not look up this address. Check your connection and try again.");
  }

  return parsePlace(data, lat, lng);
}

/**
 * Forward-geocode a written address into candidate coordinates.
 *
 * Adding a site needs a latitude/longitude — that is what every distance and
 * fare is computed from — but an admin should never have to hunt for numbers
 * on a map. They type the address as they would write it; this returns the
 * matches to choose from. Results are biased to India, which is where every
 * site in this system is.
 */
export async function forwardGeocode(query: string, limit = 5): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) throw new Error("Enter at least 3 characters of the address.");

  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10)));
  url.searchParams.set("countrycodes", "in");

  let rows: { lat: string; lon: string; display_name?: string; address?: Record<string, string> }[];
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
    rows = await res.json();
  } catch {
    throw new Error(
      "Could not look up that address right now. Check your connection, or enter the coordinates manually.",
    );
  }

  return rows
    .map((r) => parsePlace({ display_name: r.display_name ?? q, address: r.address }, Number(r.lat), Number(r.lon)))
    .filter((r) => isValidCoord(r.latitude, r.longitude));
}
