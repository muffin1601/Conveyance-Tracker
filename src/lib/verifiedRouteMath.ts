/**
 * Pure helpers for verified-route distance comparison.
 * Safe to import from client components (no Prisma / server-only deps).
 */

export interface VerifiedRouteTolerance {
  toleranceKm: number;
  tolerancePercent: number;
}

export const DEFAULT_VERIFIED_ROUTE_TOLERANCE: VerifiedRouteTolerance = {
  toleranceKm: Number(process.env.NEXT_PUBLIC_VERIFIED_ROUTE_TOLERANCE_KM ?? process.env.VERIFIED_ROUTE_TOLERANCE_KM ?? 0.5),
  tolerancePercent: Number(process.env.NEXT_PUBLIC_VERIFIED_ROUTE_TOLERANCE_PERCENT ?? process.env.VERIFIED_ROUTE_TOLERANCE_PERCENT ?? 5),
};

/**
 * Calculate distance discrepancy between submitted distance and verified distance.
 */
export function calculateDistanceDiscrepancy(
  submittedKm: number,
  verifiedKm: number,
  toleranceKm = DEFAULT_VERIFIED_ROUTE_TOLERANCE.toleranceKm,
  tolerancePercent = DEFAULT_VERIFIED_ROUTE_TOLERANCE.tolerancePercent
): {
  differenceKm: number;
  differencePercent: number;
  matchesWithinTolerance: boolean;
  exceedsTolerance: boolean;
} {
  const differenceKm = Math.round((verifiedKm - submittedKm) * 100) / 100;
  const maxRef = Math.max(submittedKm, verifiedKm);
  const differencePercent =
    maxRef > 0 ? Math.round((Math.abs(differenceKm) / maxRef) * 10000) / 100 : 0;

  // Matching if either within absolute KM tolerance OR percentage tolerance
  const matchesWithinTolerance =
    Math.abs(differenceKm) <= toleranceKm || differencePercent <= tolerancePercent;

  return {
    differenceKm,
    differencePercent,
    matchesWithinTolerance,
    exceedsTolerance: !matchesWithinTolerance,
  };
}

/**
 * A correction is redundant only when both the currently recorded trip and
 * the employee's proposed distance already match permanent route memory.
 */
export function isRedundantVerifiedRouteCorrection(
  recordedKm: number,
  submittedKm: number,
  verifiedKm: number,
  toleranceKm = DEFAULT_VERIFIED_ROUTE_TOLERANCE.toleranceKm,
  tolerancePercent = DEFAULT_VERIFIED_ROUTE_TOLERANCE.tolerancePercent,
): boolean {
  return (
    calculateDistanceDiscrepancy(recordedKm, verifiedKm, toleranceKm, tolerancePercent)
      .matchesWithinTolerance &&
    calculateDistanceDiscrepancy(submittedKm, verifiedKm, toleranceKm, tolerancePercent)
      .matchesWithinTolerance
  );
}
