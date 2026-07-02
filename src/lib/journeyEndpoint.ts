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
  fromSite?: { name: string } | null;
  toSite?: { name: string; city?: string | null } | null;
  fromCustomLocation?: { locationName: string } | null;
  toCustomLocation?: { locationName: string } | null;
}

export function legFromName(j: EndpointCarrier): string {
  return j.fromName ?? j.fromSite?.name ?? j.fromCustomLocation?.locationName ?? "—";
}

export function legToName(j: EndpointCarrier): string {
  return j.toName ?? j.toSite?.name ?? j.toCustomLocation?.locationName ?? "—";
}
