import { prisma, WRITE_TX } from "./prisma";
import type { VerifiedRouteDistance } from "@prisma/client";
import { normalizeLocationName, buildRouteKey } from "./locationNormalizer";
import { audit } from "./audit";
import {
  calculateDistanceDiscrepancy,
  DEFAULT_VERIFIED_ROUTE_TOLERANCE,
} from "./verifiedRouteMath";

export { calculateDistanceDiscrepancy } from "./verifiedRouteMath";

export interface VerifiedRouteConfig {
  detectionThreshold: number; // default: 3 approved corrections
  toleranceKm: number;        // default: 0.5 km
  tolerancePercent: number;   // default: 5%
}

export const DEFAULT_VERIFIED_ROUTE_CONFIG: VerifiedRouteConfig = {
  detectionThreshold: Number(process.env.VERIFIED_ROUTE_DETECTION_THRESHOLD ?? 3),
  toleranceKm: DEFAULT_VERIFIED_ROUTE_TOLERANCE.toleranceKm,
  tolerancePercent: DEFAULT_VERIFIED_ROUTE_TOLERANCE.tolerancePercent,
};

type RouteTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type RouteDbClient = typeof prisma | RouteTransactionClient;

async function lockRoute(db: RouteTransactionClient, routeKey: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${routeKey}::text))`;
}

const SETTING_KEY = "verified_route_config";

/**
 * Get active configuration for verified routes from database Settings or default.
 */
export async function getVerifiedRouteConfig(
  db: RouteDbClient = prisma
): Promise<VerifiedRouteConfig> {
  try {
    const setting = await db.setting.findUnique({
      where: { key: SETTING_KEY },
    });
    if (setting?.value) {
      const parsed = JSON.parse(setting.value);
      const config = {
        detectionThreshold: Number(parsed.detectionThreshold ?? DEFAULT_VERIFIED_ROUTE_CONFIG.detectionThreshold),
        toleranceKm: Number(parsed.toleranceKm ?? DEFAULT_VERIFIED_ROUTE_CONFIG.toleranceKm),
        tolerancePercent: Number(parsed.tolerancePercent ?? DEFAULT_VERIFIED_ROUTE_CONFIG.tolerancePercent),
      };
      if (
        !Number.isInteger(config.detectionThreshold) ||
        config.detectionThreshold < 1 ||
        !Number.isFinite(config.toleranceKm) ||
        config.toleranceKm <= 0 ||
        !Number.isFinite(config.tolerancePercent) ||
        config.tolerancePercent < 0
      ) {
        throw new Error("Stored verified-route configuration contains invalid values.");
      }
      return config;
    }
  } catch (err) {
    console.warn("[getVerifiedRouteConfig] Failed to load setting, using defaults:", err);
  }
  return DEFAULT_VERIFIED_ROUTE_CONFIG;
}

/**
 * Save updated configuration in Settings table.
 */
export async function updateVerifiedRouteConfig(
  config: Partial<VerifiedRouteConfig>,
  userId?: string
): Promise<VerifiedRouteConfig> {
  const current = await getVerifiedRouteConfig();
  const detectionThreshold = config.detectionThreshold ?? current.detectionThreshold;
  const toleranceKm = config.toleranceKm ?? current.toleranceKm;
  const tolerancePercent = config.tolerancePercent ?? current.tolerancePercent;
  if (!Number.isInteger(detectionThreshold) || detectionThreshold < 1) {
    throw new Error("Detection threshold must be a positive whole number.");
  }
  if (!Number.isFinite(toleranceKm) || toleranceKm <= 0) {
    throw new Error("Distance tolerance must be a positive number.");
  }
  if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0) {
    throw new Error("Percentage tolerance must be zero or greater.");
  }
  const updated: VerifiedRouteConfig = {
    detectionThreshold,
    toleranceKm,
    tolerancePercent,
  };

  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(updated) },
    update: { value: JSON.stringify(updated) },
  });

  await audit({
    userId: userId ?? null,
    action: "UPDATE",
    entity: "Setting",
    entityId: SETTING_KEY,
    meta: { previous: current, updated },
  });

  return updated;
}

/**
 * Lookup whether a permanent verified distance exists for the given From and To locations.
 */
export async function lookupVerifiedRoute(
  from: string | { name?: string | null; siteId?: string | null },
  to: string | { name?: string | null; siteId?: string | null }
) {
  const { routeKey, fromNormalized, toNormalized } = buildRouteKey(from, to);
  if (!fromNormalized || !toNormalized) {
    return {
      verifiedRoute: null,
      isVerified: false,
      verifiedDistanceKm: null,
      routeKey: "",
    };
  }

  const verified = await prisma.verifiedRouteDistance.findFirst({
    where: {
      routeKey,
      status: "ACTIVE",
    },
  });

  return {
    verifiedRoute: verified,
    isVerified: Boolean(verified),
    verifiedDistanceKm: verified?.verifiedDistanceKm ?? null,
    approvalCount: verified?.approvalCount ?? 0,
    routeKey,
  };
}

export type VerifiedRouteComparison = {
  isVerified: boolean;
  verifiedDistanceKm: number | null;
  approvalCount: number;
  matchesWithinTolerance: boolean;
  exceedsTolerance: boolean;
  differenceKm: number;
  toleranceKm: number;
  tolerancePercent: number;
  verifiedRouteMatch: "MATCH" | "EXCEEDS" | null;
  routeKey: string;
};

/**
 * Compare an employee-submitted (or measured) distance to permanent route memory.
 * Does not mutate submitted data — callers decide how to display or flag.
 */
export async function compareSubmittedToVerifiedRoute(
  fromName: string,
  toName: string,
  submittedKm: number
): Promise<VerifiedRouteComparison> {
  const lookup = await lookupVerifiedRoute(fromName, toName);
  const config = await getVerifiedRouteConfig();
  if (!lookup.isVerified || lookup.verifiedDistanceKm == null) {
    return {
      isVerified: false,
      verifiedDistanceKm: null,
      approvalCount: 0,
      matchesWithinTolerance: false,
      exceedsTolerance: false,
      differenceKm: 0,
      toleranceKm: config.toleranceKm,
      tolerancePercent: config.tolerancePercent,
      verifiedRouteMatch: null,
      routeKey: lookup.routeKey,
    };
  }

  const discrepancy = calculateDistanceDiscrepancy(
    submittedKm,
    lookup.verifiedDistanceKm,
    config.toleranceKm,
    config.tolerancePercent
  );

  return {
    isVerified: true,
    verifiedDistanceKm: lookup.verifiedDistanceKm,
    approvalCount: lookup.approvalCount ?? 0,
    matchesWithinTolerance: discrepancy.matchesWithinTolerance,
    exceedsTolerance: discrepancy.exceedsTolerance,
    differenceKm: discrepancy.differenceKm,
    toleranceKm: config.toleranceKm,
    tolerancePercent: config.tolerancePercent,
    verifiedRouteMatch: discrepancy.matchesWithinTolerance ? "MATCH" : "EXCEEDS",
    routeKey: lookup.routeKey,
  };
}

/**
 * Helper to compute representative canonical distance from a list of approved distances.
 * Uses the median / most frequent value rounded to 2 decimals.
 */
async function loadApprovedCorrectionsForRoute(
  db: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma,
  routeKey: string
) {
  return db.distanceCorrection.findMany({
    where: {
      status: "APPROVED",
      finalDistanceKm: { not: null },
      routeKey,
    },
    select: { id: true, finalDistanceKm: true },
  });
}

function computeCanonicalDistance(distances: number[]): number {
  if (!distances.length) return 0;
  if (distances.length === 1) return Math.round(distances[0] * 100) / 100;

  // Sort distances
  const sorted = [...distances].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median * 100) / 100;
}

/**
 * Process a newly approved distance correction:
 * 1. Counts all approved corrections for this route.
 * 2. If approved count reaches threshold, saves/updates VerifiedRouteDistance permanently.
 * 3. Records audit trail in VerifiedRouteAudit and AuditLog.
 */
export async function processApprovedCorrection(
  correctionId: string,
  txClient?: RouteTransactionClient
): Promise<{
  thresholdMet: boolean;
  approvalCount: number;
  verifiedDistanceKm: number | null;
  verifiedRoute: VerifiedRouteDistance | null;
}> {
  if (!txClient) {
    return prisma.$transaction((tx) => processApprovedCorrection(correctionId, tx), WRITE_TX);
  }
  const db = txClient;

  // Retrieve the correction and its journey
  const correction = await db.distanceCorrection.findUnique({
    where: { id: correctionId },
    include: {
      journey: {
        select: {
          id: true,
          fromName: true,
          toName: true,
          fromSiteId: true,
          toSiteId: true,
        },
      },
    },
  });

  if (!correction || correction.status !== "APPROVED" || correction.finalDistanceKm == null) {
    return {
      thresholdMet: false,
      approvalCount: 0,
      verifiedDistanceKm: null,
      verifiedRoute: null,
    };
  }

  const { routeKey, fromNormalized, toNormalized } = buildRouteKey(
    correction.journey.fromName ?? "",
    correction.journey.toName ?? ""
  );

  if (!fromNormalized || !toNormalized) {
    return {
      thresholdMet: false,
      approvalCount: 0,
      verifiedDistanceKm: null,
      verifiedRoute: null,
    };
  }

  await lockRoute(db, routeKey);

  // Load active threshold config
  const config = await getVerifiedRouteConfig(db);
  const matchingCorrections = await loadApprovedCorrectionsForRoute(db, routeKey);
  const approvalCount = matchingCorrections.length;
  const thresholdMet = approvalCount >= config.detectionThreshold;

  if (!thresholdMet) {
    return {
      thresholdMet: false,
      approvalCount,
      verifiedDistanceKm: null,
      verifiedRoute: null,
    };
  }

  // Calculate the verified distance
  const approvedDistances = matchingCorrections
    .map((c) => c.finalDistanceKm)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const computedDistanceKm = computeCanonicalDistance(approvedDistances);

  // Check if permanent record already exists
  const existing = await db.verifiedRouteDistance.findUnique({
    where: { routeKey },
  });

  const now = new Date();
  let verifiedRoute;

  if (existing) {
    const previousDistanceKm = existing.verifiedDistanceKm;
    const previousStatus = existing.status;
    // Never silently overwrite an administrator-set distance. Only refresh the
    // approval count / last-verified timestamp and leave the km unchanged.
    const preserveManualDistance = existing.source === "MANUAL_ADMIN";
    const nextDistanceKm = preserveManualDistance ? existing.verifiedDistanceKm : computedDistanceKm;
    // Do not reactivate DISABLED routes; ARCHIVED may be restored when threshold is met again.
    const nextStatus =
      existing.status === "DISABLED"
        ? "DISABLED"
        : existing.status === "ARCHIVED"
          ? "ACTIVE"
          : existing.status;

    verifiedRoute = await db.verifiedRouteDistance.update({
      where: { id: existing.id },
      data: {
        verifiedDistanceKm: nextDistanceKm,
        approvalCount,
        lastVerifiedAt: now,
        status: nextStatus,
      },
    });

    await db.verifiedRouteAudit.create({
      data: {
        verifiedRouteDistanceId: verifiedRoute.id,
        action: "AUTO_THRESHOLD_MET",
        previousDistanceKm,
        newDistanceKm: nextDistanceKm,
        previousStatus,
        newStatus: verifiedRoute.status,
        reason: preserveManualDistance
          ? `Threshold met (${approvalCount} approved corrections). Manual admin distance ${previousDistanceKm} km preserved; auto-computed median was ${computedDistanceKm} km.`
          : `Automatic verification updated: ${approvalCount} approved corrections recorded.`,
        performedById: correction.reviewedById ?? null,
        createdAt: now,
      },
    });
  } else {
    verifiedRoute = await db.verifiedRouteDistance.create({
      data: {
        routeKey,
        fromNormalized,
        toNormalized,
        fromLocationName: correction.journey.fromName ?? fromNormalized,
        toLocationName: correction.journey.toName ?? toNormalized,
        fromSiteId: correction.journey.fromSiteId ?? null,
        toSiteId: correction.journey.toSiteId ?? null,
        verifiedDistanceKm: computedDistanceKm,
        approvalCount,
        source: "AUTO_VERIFIED",
        status: "ACTIVE",
        lastVerifiedAt: now,
        verifiedById: correction.reviewedById ?? null,
        notes: `Automatically verified after reaching threshold of ${approvalCount} approved corrections.`,
      },
    });

    await db.verifiedRouteAudit.create({
      data: {
        verifiedRouteDistanceId: verifiedRoute.id,
        action: "AUTO_THRESHOLD_MET",
        previousDistanceKm: null,
        newDistanceKm: computedDistanceKm,
        previousStatus: null,
        newStatus: "ACTIVE",
        reason: `Initial automatic verification: met threshold of ${config.detectionThreshold} approved corrections (total: ${approvalCount}).`,
        performedById: correction.reviewedById ?? null,
        createdAt: now,
      },
    });
  }

  await db.auditLog.create({
    data: {
      userId: correction.reviewedById ?? null,
      action: "VERIFY_ROUTE",
      entity: "VerifiedRouteDistance",
      entityId: verifiedRoute.id,
      meta: JSON.stringify({
        routeKey,
        approvalCount,
        verifiedDistanceKm: verifiedRoute.verifiedDistanceKm,
        computedDistanceKm,
        source: verifiedRoute.source,
        correctionId: correction.id,
      }),
    },
  });

  return {
    thresholdMet: true,
    approvalCount,
    verifiedDistanceKm: verifiedRoute.verifiedDistanceKm,
    verifiedRoute,
  };
}

/**
 * Manually verify or update a route distance by an authorized administrator.
 */
export async function manuallyVerifyRoute(input: {
  fromLocation: string;
  toLocation: string;
  distanceKm: number;
  adminUserId?: string;
  notes?: string;
  fromSiteId?: string;
  toSiteId?: string;
}) {
  const { routeKey, fromNormalized, toNormalized } = buildRouteKey(
    input.fromLocation,
    input.toLocation
  );

  if (!fromNormalized || !toNormalized) {
    throw new Error("Invalid From and To locations.");
  }
  if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    throw new Error("Verified distance must be a positive number.");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await lockRoute(tx, routeKey);
    const existing = await tx.verifiedRouteDistance.findUnique({ where: { routeKey } });

    if (existing) {
      const record = await tx.verifiedRouteDistance.update({
        where: { id: existing.id },
        data: {
          verifiedDistanceKm: input.distanceKm,
          source: "MANUAL_ADMIN",
          status: "ACTIVE",
          notes: input.notes?.trim() || existing.notes,
          lastVerifiedAt: now,
          verifiedById: input.adminUserId ?? existing.verifiedById,
        },
      });

      await tx.verifiedRouteAudit.create({
        data: {
          verifiedRouteDistanceId: record.id,
          action: "MANUAL_UPDATE",
          previousDistanceKm: existing.verifiedDistanceKm,
          newDistanceKm: input.distanceKm,
          previousStatus: existing.status,
          newStatus: "ACTIVE",
          reason: input.notes?.trim() || "Manual distance update by administrator.",
          performedById: input.adminUserId ?? null,
          createdAt: now,
        },
      });
      return { record, existed: true };
    }

    const record = await tx.verifiedRouteDistance.create({
      data: {
        routeKey,
        fromNormalized,
        toNormalized,
        fromLocationName: input.fromLocation.trim(),
        toLocationName: input.toLocation.trim(),
        fromSiteId: input.fromSiteId ?? null,
        toSiteId: input.toSiteId ?? null,
        verifiedDistanceKm: input.distanceKm,
        approvalCount: 0,
        source: "MANUAL_ADMIN",
        status: "ACTIVE",
        notes: input.notes?.trim() || "Manually verified by administrator.",
        lastVerifiedAt: now,
        verifiedById: input.adminUserId ?? null,
      },
    });

    await tx.verifiedRouteAudit.create({
      data: {
        verifiedRouteDistanceId: record.id,
        action: "MANUAL_CREATE",
        previousDistanceKm: null,
        newDistanceKm: input.distanceKm,
        previousStatus: null,
        newStatus: "ACTIVE",
        reason: input.notes?.trim() || "Manually created by administrator.",
        performedById: input.adminUserId ?? null,
        createdAt: now,
      },
    });
    return { record, existed: false };
  }, WRITE_TX);
  const { record, existed } = result;

  await audit({
    userId: input.adminUserId ?? null,
    action: existed ? "UPDATE" : "CREATE",
    entity: "VerifiedRouteDistance",
    entityId: record.id,
    meta: {
      routeKey,
      verifiedDistanceKm: input.distanceKm,
      notes: input.notes,
    },
  });

  return record;
}

/**
 * Update an existing verified route distance with an audit log.
 */
export async function updateVerifiedDistance(input: {
  id: string;
  distanceKm: number;
  adminUserId?: string;
  notes?: string;
}) {
  if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    throw new Error("Enter a valid distance in KM.");
  }

  const now = new Date();
  const { existing, updated } = await prisma.$transaction(async (tx) => {
    const route = await tx.verifiedRouteDistance.findUnique({
      where: { id: input.id },
      select: { routeKey: true },
    });
    if (!route) throw new Error("Verified route record not found.");
    await lockRoute(tx, route.routeKey);
    const existing = await tx.verifiedRouteDistance.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("Verified route record not found.");

    const updated = await tx.verifiedRouteDistance.update({
      where: { id: input.id },
      data: {
        verifiedDistanceKm: input.distanceKm,
        notes: input.notes?.trim() || existing.notes,
        lastVerifiedAt: now,
        verifiedById: input.adminUserId ?? existing.verifiedById,
      },
    });

    await tx.verifiedRouteAudit.create({
      data: {
        verifiedRouteDistanceId: updated.id,
        action: "MANUAL_UPDATE",
        previousDistanceKm: existing.verifiedDistanceKm,
        newDistanceKm: input.distanceKm,
        previousStatus: existing.status,
        newStatus: updated.status,
        reason: input.notes?.trim() || "Verified distance updated by administrator.",
        performedById: input.adminUserId ?? null,
        createdAt: now,
      },
    });
    return { existing, updated };
  }, WRITE_TX);

  await audit({
    userId: input.adminUserId ?? null,
    action: "UPDATE",
    entity: "VerifiedRouteDistance",
    entityId: updated.id,
    meta: {
      previousDistanceKm: existing.verifiedDistanceKm,
      newDistanceKm: input.distanceKm,
      reason: input.notes,
    },
  });

  return updated;
}

/**
 * Toggle or change the status of a verified route (ACTIVE, DISABLED, ARCHIVED).
 */
export async function setVerifiedRouteStatus(input: {
  id: string;
  status: "ACTIVE" | "DISABLED" | "ARCHIVED";
  adminUserId?: string;
  reason?: string;
}) {
  const now = new Date();
  const { existing, updated } = await prisma.$transaction(async (tx) => {
    const route = await tx.verifiedRouteDistance.findUnique({
      where: { id: input.id },
      select: { routeKey: true },
    });
    if (!route) throw new Error("Verified route record not found.");
    await lockRoute(tx, route.routeKey);
    const existing = await tx.verifiedRouteDistance.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("Verified route record not found.");

    const updated = await tx.verifiedRouteDistance.update({
      where: { id: input.id },
      data: { status: input.status },
    });

    await tx.verifiedRouteAudit.create({
      data: {
        verifiedRouteDistanceId: updated.id,
        action: "STATUS_CHANGE",
        previousDistanceKm: existing.verifiedDistanceKm,
        newDistanceKm: existing.verifiedDistanceKm,
        previousStatus: existing.status,
        newStatus: input.status,
        reason: input.reason?.trim() || `Status updated to ${input.status}.`,
        performedById: input.adminUserId ?? null,
        createdAt: now,
      },
    });
    return { existing, updated };
  }, WRITE_TX);

  await audit({
    userId: input.adminUserId ?? null,
    action: "STATUS_CHANGE",
    entity: "VerifiedRouteDistance",
    entityId: updated.id,
    meta: {
      previousStatus: existing.status,
      newStatus: input.status,
      reason: input.reason,
    },
  });

  return updated;
}

/**
 * Retrieve comprehensive statistics and intelligence for the admin dashboard.
 */
export async function getCorrectionIntelligenceData(filters?: {
  employeeId?: string;
  period?: string;
  fromDate?: string;
  toDate?: string;
  fromLocation?: string;
  toLocation?: string;
  status?: string;
}) {
  const config = await getVerifiedRouteConfig();

  const workDateFilter = filters?.fromDate || filters?.toDate
    ? {
        workDate: {
          ...(filters.fromDate ? { gte: filters.fromDate } : {}),
          ...(filters.toDate ? { lte: filters.toDate } : {}),
        },
      }
    : filters?.period
      ? { workDate: { startsWith: filters.period } }
      : {};

  // 1. Fetch corrections with journey and employee
  const corrections = await prisma.distanceCorrection.findMany({
    where: {
      ...(filters?.status && filters.status !== "ALL" ? { status: filters.status } : {}),
      ...(filters?.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(Object.keys(workDateFilter).length ? { journey: workDateFilter } : {}),
    },
    include: {
      employee: { select: { id: true, name: true, employeeCode: true } },
      journey: {
        select: {
          id: true,
          workDate: true,
          fromName: true,
          toName: true,
          fromSiteId: true,
          toSiteId: true,
          distanceKm: true,
        },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  // 2. Fetch permanently verified routes
  const verifiedRoutes = await prisma.verifiedRouteDistance.findMany({
    include: {
      history: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: [{ approvalCount: "desc" }, { lastVerifiedAt: "desc" }],
  });

  // Map of verified routes by routeKey
  const verifiedMap = new Map(verifiedRoutes.map((vr) => [vr.routeKey, vr]));

  // 3. Compute Aggregates
  const totalSubmissions = corrections.length;
  const approvedCorrections = corrections.filter((c) => c.status === "APPROVED");
  const totalApproved = approvedCorrections.length;
  const pendingReviews = corrections.filter((c) =>
    ["PENDING", "MANUAL_REVIEW", "AUTO_VERIFIED"].includes(c.status)
  ).length;

  const totalDiscrepancyKm = corrections.reduce((acc, c) => acc + (c.differenceKm || 0), 0);
  const avgDiscrepancyKm =
    totalSubmissions > 0 ? Math.round((totalDiscrepancyKm / totalSubmissions) * 100) / 100 : 0;

  // 4. Route Frequency & Intelligence Grouping
  const routeGroups = new Map<
    string,
    {
      routeKey: string;
      fromLocation: string;
      toLocation: string;
      fromNormalized: string;
      toNormalized: string;
      totalCorrections: number;
      approvedCorrections: number;
      correctionStatuses: Map<string, number>;
      submittedDistances: number[];
      finalDistances: number[];
      employees: Set<string>;
      employeeIds: Set<string>;
      dates: Set<string>;
      lastSubmissionAt: Date;
      verifiedRecord: VerifiedRouteDistance | null;
    }
  >();

  for (const c of corrections) {
    const fromName = c.journey.fromName || "Unknown";
    const toName = c.journey.toName || "Unknown";
    const { routeKey, fromNormalized, toNormalized } = buildRouteKey(fromName, toName);

    if (!routeGroups.has(routeKey)) {
      routeGroups.set(routeKey, {
        routeKey,
        fromLocation: fromName,
        toLocation: toName,
        fromNormalized,
        toNormalized,
        totalCorrections: 0,
        approvedCorrections: 0,
        correctionStatuses: new Map(),
        submittedDistances: [],
        finalDistances: [],
        employees: new Set(),
        employeeIds: new Set(),
        dates: new Set(),
        lastSubmissionAt: c.submittedAt,
        verifiedRecord: verifiedMap.get(routeKey) ?? null,
      });
    }

    const item = routeGroups.get(routeKey)!;
    item.totalCorrections++;
    if (c.status === "APPROVED") item.approvedCorrections++;
    item.correctionStatuses.set(c.status, (item.correctionStatuses.get(c.status) ?? 0) + 1);
    item.submittedDistances.push(c.submittedDistanceKm);
    if (c.finalDistanceKm != null) item.finalDistances.push(c.finalDistanceKm);
    item.employees.add(c.employee.name);
    item.employeeIds.add(c.employeeId);
    item.dates.add(c.journey.workDate);
    if (c.submittedAt > item.lastSubmissionAt) {
      item.lastSubmissionAt = c.submittedAt;
    }
  }

  // Include admin-verified routes that have no correction submissions yet
  for (const vr of verifiedRoutes) {
    if (routeGroups.has(vr.routeKey)) continue;
    routeGroups.set(vr.routeKey, {
      routeKey: vr.routeKey,
      fromLocation: vr.fromLocationName,
      toLocation: vr.toLocationName,
      fromNormalized: vr.fromNormalized,
      toNormalized: vr.toNormalized,
      totalCorrections: 0,
      approvedCorrections: vr.approvalCount,
      correctionStatuses: new Map(),
      submittedDistances: [],
      finalDistances: [vr.verifiedDistanceKm],
      employees: new Set(),
      employeeIds: new Set(),
      dates: new Set(),
      lastSubmissionAt: vr.lastVerifiedAt,
      verifiedRecord: vr,
    });
  }

  // 5. Employee Frequency Grouping
  const employeeStats = new Map<
    string,
    {
      employeeId: string;
      name: string;
      code: string;
      totalCorrections: number;
      approvedCorrections: number;
      avgDifferenceKm: number;
      totalDifferenceKm: number;
    }
  >();

  for (const c of corrections) {
    const empId = c.employeeId;
    if (!employeeStats.has(empId)) {
      employeeStats.set(empId, {
        employeeId: empId,
        name: c.employee.name,
        code: c.employee.employeeCode,
        totalCorrections: 0,
        approvedCorrections: 0,
        avgDifferenceKm: 0,
        totalDifferenceKm: 0,
      });
    }
    const emp = employeeStats.get(empId)!;
    emp.totalCorrections++;
    if (c.status === "APPROVED") emp.approvedCorrections++;
    emp.totalDifferenceKm += c.differenceKm || 0;
  }

  for (const emp of employeeStats.values()) {
    emp.avgDifferenceKm =
      emp.totalCorrections > 0
        ? Math.round((emp.totalDifferenceKm / emp.totalCorrections) * 100) / 100
        : 0;
  }

  const topEmployees = Array.from(employeeStats.values())
    .sort((a, b) => b.totalCorrections - a.totalCorrections)
    .slice(0, 10);

  // 6. Build Route Table Items with Filters
  let routeItems = Array.from(routeGroups.values()).map((g) => {
    const avgSubmitted =
      g.submittedDistances.length > 0
        ? Math.round((g.submittedDistances.reduce((a, b) => a + b, 0) / g.submittedDistances.length) * 100) / 100
        : 0;

    const typicalFinal =
      g.finalDistances.length > 0
        ? computeCanonicalDistance(g.finalDistances)
        : null;

    const isFrequentlyCorrected = g.approvedCorrections >= config.detectionThreshold;
    const verifiedDistance = g.verifiedRecord?.verifiedDistanceKm ?? typicalFinal;
    const isVerified = Boolean(g.verifiedRecord && g.verifiedRecord.status === "ACTIVE");

    return {
      routeKey: g.routeKey,
      fromLocation: g.verifiedRecord?.fromLocationName || g.fromLocation,
      toLocation: g.verifiedRecord?.toLocationName || g.toLocation,
      submittedKm: avgSubmitted,
      verifiedKm: verifiedDistance,
      isVerified,
      status: g.verifiedRecord?.status ?? (isFrequentlyCorrected ? "FREQUENT_UNVERIFIED" : "PENDING_THRESHOLD"),
      correctionCount: g.totalCorrections,
      approvedCount: g.approvedCorrections,
      correctionStatuses: Object.fromEntries(g.correctionStatuses),
      isFrequentlyCorrected,
      lastVerified: g.verifiedRecord?.lastVerifiedAt?.toISOString() ?? null,
      lastSubmission: g.lastSubmissionAt.toISOString(),
      uniqueEmployeesCount: g.employees.size,
      employees: Array.from(g.employees),
      employeeIds: Array.from(g.employeeIds),
      correctionDates: Array.from(g.dates),
      verifiedRouteId: g.verifiedRecord?.id ?? null,
      verifiedSource: g.verifiedRecord?.source ?? null,
    };
  });

  // Apply location text filters if provided
  if (filters?.fromLocation) {
    const f = normalizeLocationName(filters.fromLocation);
    routeItems = routeItems.filter((r) => normalizeLocationName(r.fromLocation).includes(f));
  }
  if (filters?.toLocation) {
    const t = normalizeLocationName(filters.toLocation);
    routeItems = routeItems.filter((r) => normalizeLocationName(r.toLocation).includes(t));
  }

  // Sort: verified and frequently corrected routes first, then by correction count
  routeItems.sort((a, b) => {
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    if (a.isFrequentlyCorrected !== b.isFrequentlyCorrected) return a.isFrequentlyCorrected ? -1 : 1;
    return b.approvedCount - a.approvedCount;
  });

  const totalFrequentlyCorrectedRoutes = routeItems.filter((r) => r.isFrequentlyCorrected).length;
  const totalPermanentlyVerifiedRoutes = verifiedRoutes.filter((r) => r.status === "ACTIVE").length;
  const topFrequentRoutes = routeItems.slice(0, 10);

  const flaggedJourneys = await prisma.journey.findMany({
    where: {
      verifiedRouteMatch: "EXCEEDS",
      ...(filters?.employeeId ? { employeeId: filters.employeeId } : {}),
      ...workDateFilter,
    },
    select: {
      id: true,
      workDate: true,
      employeeId: true,
      fromName: true,
      toName: true,
      distanceKm: true,
      verifiedDistanceKm: true,
      verifiedDiscrepancyKm: true,
      employee: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const discrepancyFlags = flaggedJourneys.map((j) => ({
    journeyId: j.id,
    employeeId: j.employeeId,
    employee: j.employee.name,
    workDate: j.workDate,
    fromLocation: j.fromName ?? "Start",
    toLocation: j.toName ?? "Destination",
    submittedKm: j.distanceKm,
    verifiedKm: j.verifiedDistanceKm,
    differenceKm: j.verifiedDiscrepancyKm,
  }));

  return {
    config,
    metrics: {
      totalSubmissions,
      totalApproved,
      totalFrequentlyCorrectedRoutes,
      totalPermanentlyVerifiedRoutes,
      avgDiscrepancyKm,
      pendingReviews,
      flaggedDiscrepancies: discrepancyFlags.length,
    },
    topFrequentRoutes,
    topEmployees,
    routes: routeItems,
    verifiedRoutes,
    discrepancyFlags,
  };
}

/**
 * Retrieve detailed correction history for a specific route for audits and reports.
 */
export async function getRouteCorrectionHistory(routeKey: string) {
  const verified = await prisma.verifiedRouteDistance.findUnique({
    where: { routeKey },
    include: {
      history: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const include = {
    employee: {
      select: { id: true, name: true, employeeCode: true },
    },
    journey: {
      select: {
        id: true,
        workDate: true,
        fromName: true,
        toName: true,
        distanceKm: true,
      },
    },
  } as const;

  // Prefer indexed routeKey; also include legacy rows matched by normalized journey names.
  const keyed = await prisma.distanceCorrection.findMany({
    where: { routeKey },
    include,
    orderBy: { submittedAt: "desc" },
  });

  const legacy = await prisma.distanceCorrection.findMany({
    where: {
      OR: [{ routeKey: null }, { routeKey: "" }],
    },
    include,
    orderBy: { submittedAt: "desc" },
  });

  const knownIds = new Set(keyed.map((c) => c.id));
  const matching = [
    ...keyed,
    ...legacy.filter((c) => {
      if (knownIds.has(c.id)) return false;
      const k = buildRouteKey(c.journey.fromName ?? "", c.journey.toName ?? "");
      return k.routeKey === routeKey;
    }),
  ].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

  return {
    routeKey,
    verifiedRoute: verified,
    corrections: matching.map((c) => ({
      id: c.id,
      employeeId: c.employee.id,
      employeeName: c.employee.name,
      employeeCode: c.employee.employeeCode,
      workDate: c.journey.workDate,
      fromLocation: c.journey.fromName,
      toLocation: c.journey.toName,
      originalDistanceKm: c.originalDistanceKm,
      submittedDistanceKm: c.submittedDistanceKm,
      finalDistanceKm: c.finalDistanceKm,
      differenceKm: c.differenceKm,
      status: c.status,
      userReason: c.userReason,
      reviewReason: c.reviewReason,
      adminNote: c.adminNote,
      submittedAt: c.submittedAt.toISOString(),
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
      reviewedById: c.reviewedById,
    })),
    auditHistory: verified?.history ?? [],
  };
}
