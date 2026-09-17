export const DISTANCE_CORRECTION_CONFIG = {
  endpointRadiusMeters: Number(process.env.DISTANCE_CORRECTION_ENDPOINT_RADIUS_METERS ?? 300),
  smallDifferencePercent: Number(process.env.DISTANCE_CORRECTION_SMALL_DIFFERENCE_PERCENT ?? 5),
  autoVerifyMaxPercent: Number(process.env.DISTANCE_CORRECTION_AUTO_VERIFY_MAX_PERCENT ?? 20),
  maxTripKm: Number(process.env.DISTANCE_CORRECTION_MAX_TRIP_KM ?? 1000),
} as const;

export function distanceDifference(original: number, submitted: number) {
  const differenceKm = Math.abs(submitted - original);
  return { differenceKm, differencePercent: Math.max(original, submitted) > 0 ? differenceKm / Math.max(original, submitted) * 100 : 0 };
}
export function verificationDecision(input: { differencePercent: number; endpointMatch: boolean; usableGpsPoints: number; hasScreenshot: boolean }) {
  if (input.differencePercent <= DISTANCE_CORRECTION_CONFIG.smallDifferencePercent) return { status: "MANUAL_REVIEW", reason: "The recorded distance is already very close to the submitted distance." };
  if (input.differencePercent > DISTANCE_CORRECTION_CONFIG.autoVerifyMaxPercent) return { status: "MANUAL_REVIEW", reason: "The difference needs a manager review." };
  if (input.endpointMatch && input.usableGpsPoints >= 2 && input.hasScreenshot) return { status: "AUTO_VERIFIED", reason: null };
  return { status: "MANUAL_REVIEW", reason: "We couldn't verify this trip automatically." };
}
export function getEffectiveTripDistance<T extends { distanceKm: number; distanceCorrection?: { status: string; finalDistanceKm: number | null } | null }>(trip: T): number {
  const c = trip.distanceCorrection;
  return c && ["AUTO_VERIFIED", "APPROVED"].includes(c.status) && c.finalDistanceKm != null ? c.finalDistanceKm : trip.distanceKm;
}
