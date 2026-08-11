/**
 * Resolve a journey leg's from/to labels regardless of endpoint kind.
 *
 * New legs carry denormalised `fromName`/`toName` snapshots. Legs created
 * before this feature (or edge cases) fall back to the related Site or
 * UserCustomLocation record. Keeps every reader (summary, admin, export)
 * from having to branch on endpoint type.
 */
export interface EndpointCarrier {
  fromName?: string | null;
  toName?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  fromSite?: { name: string; address?: string | null } | null;
  toSite?: { name: string; city?: string | null; address?: string | null } | null;
  fromCustomLocation?: { locationName: string; address?: string | null } | null;
  toCustomLocation?: { locationName: string; address?: string | null } | null;
}

export function legFromName(j: EndpointCarrier): string {
  return j.fromName ?? j.fromSite?.name ?? j.fromCustomLocation?.locationName ?? "—";
}

export function legToName(j: EndpointCarrier): string {
  return j.toName ?? j.toSite?.name ?? j.toCustomLocation?.locationName ?? "—";
}

/**
 * The full street address of a leg's endpoint, when one is known.
 *
 * A GPS leg carries its own snapshot (what the geocoder returned where the
 * employee was standing); a master-site or saved-location leg has none of its
 * own and reads the current address off the related record. Null means there
 * is genuinely nothing to show — callers fall back to the name alone rather
 * than inventing a location.
 */
export function legToAddress(j: EndpointCarrier): string | null {
  return j.toAddress ?? j.toSite?.address ?? j.toCustomLocation?.address ?? null;
}

export function legFromAddress(j: EndpointCarrier): string | null {
  return j.fromAddress ?? j.fromSite?.address ?? j.fromCustomLocation?.address ?? null;
}
