/**
 * Backfill permanently verified routes from approved historical corrections.
 *
 * Scans all approved corrections, identifies routes with >= 3 approved corrections,
 * and creates VerifiedRouteDistance records with audit trails.
 *
 * Usage:
 *   npx tsx scripts/backfill-verified-routes.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { buildRouteKey } from "../src/lib/locationNormalizer";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function computeCanonicalDistance(distances: number[]): number {
  if (!distances.length) return 0;
  if (distances.length === 1) return Math.round(distances[0] * 100) / 100;
  const sorted = [...distances].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median * 100) / 100;
}

async function main() {
  const savedConfig = await prisma.setting.findUnique({ where: { key: "verified_route_config" } });
  const configuredThreshold = savedConfig?.value
    ? JSON.parse(savedConfig.value).detectionThreshold
    : undefined;
  const threshold = Number(
    configuredThreshold ?? process.env.VERIFIED_ROUTE_DETECTION_THRESHOLD ?? 3
  );
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("Verified-route detection threshold must be a positive whole number.");
  }

  console.log(`Starting verified route backfill (Threshold: ${threshold} approved corrections)...`);
  console.log(`Mode: ${APPLY ? "APPLY (writing to database)" : "DRY RUN (preview only, use --apply to commit)"}\n`);

  const approvedCorrections = await prisma.distanceCorrection.findMany({
    where: {
      status: "APPROVED",
      finalDistanceKm: { not: null },
    },
    include: {
      journey: {
        select: {
          fromName: true,
          toName: true,
          fromSiteId: true,
          toSiteId: true,
        },
      },
      employee: {
        select: { name: true },
      },
    },
    orderBy: { reviewedAt: "desc" },
  });

  console.log(`Total approved corrections in historical database: ${approvedCorrections.length}`);

  const routeGroups = new Map<
    string,
    {
      routeKey: string;
      fromLocation: string;
      toLocation: string;
      fromNormalized: string;
      toNormalized: string;
      fromSiteId: string | null;
      toSiteId: string | null;
      distances: number[];
      employees: Set<string>;
      lastReviewedAt: Date;
    }
  >();

  for (const c of approvedCorrections) {
    const fromName = c.journey.fromName || "Unknown";
    const toName = c.journey.toName || "Unknown";
    const { routeKey, fromNormalized, toNormalized } = buildRouteKey(fromName, toName);

    if (!fromNormalized || !toNormalized) continue;

    if (!routeGroups.has(routeKey)) {
      routeGroups.set(routeKey, {
        routeKey,
        fromLocation: fromName,
        toLocation: toName,
        fromNormalized,
        toNormalized,
        fromSiteId: c.journey.fromSiteId ?? null,
        toSiteId: c.journey.toSiteId ?? null,
        distances: [],
        employees: new Set(),
        lastReviewedAt: c.reviewedAt ?? new Date(),
      });
    }

    const group = routeGroups.get(routeKey)!;
    if (c.finalDistanceKm != null) group.distances.push(c.finalDistanceKm);
    group.employees.add(c.employee.name);
    if (c.reviewedAt && c.reviewedAt > group.lastReviewedAt) {
      group.lastReviewedAt = c.reviewedAt;
    }
  }

  const frequentRoutes = Array.from(routeGroups.values())
    .filter((g) => g.distances.length >= threshold)
    .sort((a, b) => b.distances.length - a.distances.length);

  console.log(`Routes meeting threshold (>= ${threshold} approved corrections): ${frequentRoutes.length}\n`);

  let createdCount = 0;
  let updatedCount = 0;

  for (const r of frequentRoutes) {
    const verifiedDistanceKm = computeCanonicalDistance(r.distances);
    console.log(
      `✓ [${r.distances.length} approved] ${r.fromLocation} -> ${r.toLocation}` +
        ` | Verified: ${verifiedDistanceKm} KM` +
        ` | Distances: [${r.distances.slice(0, 5).join(", ")}]` +
        ` | Staff: [${Array.from(r.employees).join(", ")}]`
    );

    if (APPLY) {
      // Stamp routeKey onto matching approved corrections for indexed lookups
      for (const c of approvedCorrections) {
        const fromName = c.journey.fromName || "Unknown";
        const toName = c.journey.toName || "Unknown";
        const key = buildRouteKey(fromName, toName).routeKey;
        if (key === r.routeKey && !c.routeKey) {
          await prisma.distanceCorrection.update({
            where: { id: c.id },
            data: { routeKey: r.routeKey },
          });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.verifiedRouteDistance.findUnique({
          where: { routeKey: r.routeKey },
        });

        if (existing) {
          const preserveManual = existing.source === "MANUAL_ADMIN";
          const updated = await tx.verifiedRouteDistance.update({
            where: { id: existing.id },
            data: {
              verifiedDistanceKm: preserveManual ? existing.verifiedDistanceKm : verifiedDistanceKm,
              approvalCount: r.distances.length,
              lastVerifiedAt: r.lastReviewedAt,
              status: existing.status,
            },
          });
          await tx.verifiedRouteAudit.create({
            data: {
              verifiedRouteDistanceId: updated.id,
              action: "AUTO_THRESHOLD_MET",
              previousDistanceKm: existing.verifiedDistanceKm,
              newDistanceKm: updated.verifiedDistanceKm,
              previousStatus: existing.status,
              newStatus: updated.status,
              reason: preserveManual
                ? `Historical backfill: ${r.distances.length} approved corrections. Administrator distance preserved.`
                : `Historical backfill updated from ${r.distances.length} approved corrections.`,
              createdAt: r.lastReviewedAt,
            },
          });
          return true;
        }

        const created = await tx.verifiedRouteDistance.create({
          data: {
            routeKey: r.routeKey,
            fromNormalized: r.fromNormalized,
            toNormalized: r.toNormalized,
            fromLocationName: r.fromLocation,
            toLocationName: r.toLocation,
            fromSiteId: r.fromSiteId,
            toSiteId: r.toSiteId,
            verifiedDistanceKm,
            approvalCount: r.distances.length,
            source: "AUTO_VERIFIED",
            status: "ACTIVE",
            lastVerifiedAt: r.lastReviewedAt,
            notes: `Backfilled from historical records with ${r.distances.length} approved corrections.`,
          },
        });
        await tx.verifiedRouteAudit.create({
          data: {
            verifiedRouteDistanceId: created.id,
            action: "AUTO_THRESHOLD_MET",
            previousDistanceKm: null,
            newDistanceKm: verifiedDistanceKm,
            previousStatus: null,
            newStatus: "ACTIVE",
            reason: `Historical backfill: met threshold of ${threshold} approved corrections (total: ${r.distances.length}).`,
            createdAt: r.lastReviewedAt,
          },
        });
        return false;
      });

      if (updated) {
        updatedCount++;
      } else {
        createdCount++;
      }
    }
  }

  console.log("\nSummary:");
  if (APPLY) {
    console.log(`Created: ${createdCount} verified routes`);
    console.log(`Updated: ${updatedCount} verified routes`);
    console.log("Backfill completed successfully!");
  } else {
    console.log(`Dry run complete. ${frequentRoutes.length} routes qualify for verified distance memory.`);
    console.log("Re-run with --apply to commit records to the database.");
  }
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
