import "server-only";

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
  area: string | null;
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

export function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

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

  const a = data.address ?? {};
  const city =
    a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
  const area =
    a.suburb ?? a.neighbourhood ?? a.city_district ?? a.locality ?? null;

  return {
    address: data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    area,
    city,
    state: a.state ?? null,
    country: a.country ?? null,
    postalCode: a.postcode ?? null,
    latitude: lat,
    longitude: lng,
  };
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
    .map((r) => {
      const a = r.address ?? {};
      return {
        address: r.display_name ?? q,
        area: a.suburb ?? a.neighbourhood ?? a.city_district ?? a.locality ?? null,
        city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null,
        state: a.state ?? null,
        country: a.country ?? null,
        postalCode: a.postcode ?? null,
        latitude: Number(r.lat),
        longitude: Number(r.lon),
      };
    })
    .filter((r) => isValidCoord(r.latitude, r.longitude));
}
