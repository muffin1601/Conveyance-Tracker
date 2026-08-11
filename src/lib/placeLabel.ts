/**
 * How a raw geocoder response becomes a place name.
 *
 * Deliberately free of `server-only` and of any network code: the Next server
 * (lib/geocode.ts) and the offline backfill (scripts/backfill-gps-names.ts)
 * both name places through here, so a leg logged today and a leg renamed by
 * the backfill can never disagree about what to call the same coordinates.
 */

/** The address block Nominatim returns under `address`. */
export type NominatimAddress = Record<string, string>;

export interface PlaceParts {
  address: string;
  /** The most specific named place around the fix — locality, then road. */
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
}

/**
 * The neighbourhood-level name for a fix, most specific first.
 *
 * Nominatim fills different keys depending on how the area is mapped, so a
 * single key is never enough: in Delhi a colony comes back as `suburb`, a
 * DLF block as `neighbourhood`, an unnamed pocket only as `road`. Taking the
 * first one that exists is what turns "Delhi, Delhi" into "Kirti Nagar, Delhi".
 */
export function resolveArea(a: NominatimAddress): string | null {
  return (
    a.neighbourhood ?? a.suburb ?? a.quarter ?? a.residential ?? a.city_district ??
    a.locality ?? a.hamlet ?? a.village ?? a.town ?? a.road ?? null
  );
}

export function resolveCity(a: NominatimAddress): string | null {
  return a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
}

/**
 * "<area>, <city>" — the label an employee sees for a GPS destination.
 *
 * Each part is dropped when it repeats one already used, which is the whole
 * point: Delhi's city AND state are both "Delhi", so the old city+state format
 * produced "Delhi, Delhi" for every fix in the city and told nobody anything.
 * State is only reached for when there is no city (rural fixes), and raw
 * coordinates only when the provider returned nothing nameable at all.
 */
export function placeLabel(g: {
  area: string | null; city: string | null; state: string | null;
  latitude: number; longitude: number;
}): string {
  const parts: string[] = [];
  for (const p of [g.area, g.city, g.state]) {
    const v = p?.trim();
    if (!v) continue;
    if (parts.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
    parts.push(v);
    if (parts.length === 2) break;
  }
  return parts.length ? parts.join(", ") : `${g.latitude.toFixed(5)}, ${g.longitude.toFixed(5)}`;
}

/** Turn one Nominatim row into the fields every caller reads. */
export function parsePlace(
  data: { display_name?: string; address?: NominatimAddress },
  lat: number,
  lng: number,
): PlaceParts & { label: string } {
  const a = data.address ?? {};
  const parts: PlaceParts = {
    address: data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    // The area may itself be the city (a fix in the middle of a small town), in
    // which case it adds nothing and the label falls through to city + state.
    area: resolveArea(a),
    city: resolveCity(a),
    state: a.state ?? null,
    country: a.country ?? null,
    postalCode: a.postcode ?? null,
    latitude: lat,
    longitude: lng,
  };
  return { ...parts, label: placeLabel(parts) };
}
