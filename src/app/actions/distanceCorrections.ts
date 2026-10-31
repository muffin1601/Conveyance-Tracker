"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, WRITE_TX } from "@/lib/prisma";
import { attempt, ok, fail, UserError, type ActionResult } from "@/lib/result";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildBillPath, createSignedDownloadUrl, createSignedUploadUrl, isUploadConfigured } from "@/lib/storage";
import { distanceDifference, DISTANCE_CORRECTION_CONFIG } from "@/lib/distanceCorrection";
import { haversineMeters } from "@/lib/gps";
import { isSettingsUnlocked } from "./settings";
import { computeLegAmount } from "@/lib/conveyance";
import { getSettings } from "@/lib/settings";
import type { VehicleType } from "@/lib/enums";
import { isRedundantVerifiedRouteCorrection } from "@/lib/verifiedRouteMath";

import {
  processApprovedCorrection,
  manuallyVerifyRoute,
  updateVerifiedDistance,
  setVerifiedRouteStatus,
  updateVerifiedRouteConfig,
  getRouteCorrectionHistory,
  getCorrectionIntelligenceData,
  lookupVerifiedRoute,
  compareSubmittedToVerifiedRoute,
  type VerifiedRouteConfig,
} from "@/lib/verifiedRoutes";
import { buildRouteKey } from "@/lib/locationNormalizer";

const image = z.object({ path: z.string().min(1), name: z.string().min(1).max(200), type: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().positive().max(5 * 1024 * 1024) });
const request = z.object({
  journeyId: z.string().min(1),
  submittedDistanceKm: z.number().finite().positive().max(DISTANCE_CORRECTION_CONFIG.maxTripKm),
  screenshot: image,
  reason: z.string().trim().max(500).optional(),
});

async function ownJourney(journeyId: string) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("Please select your name first.");
  const journey = await prisma.journey.findUnique({ where: { id: journeyId }, select: { id: true, employeeId: true, distanceKm: true, gpsLat: true, gpsLng: true, toLat: true, toLng: true, gpsDistanceM: true, fromName: true, toName: true } });
  if (!journey || journey.employeeId !== user.employeeId) throw new Error("Trip not found.");
  return { user, journey };
}

export async function requestDistanceCorrectionUpload(input: { journeyId: string; filename: string; mimeType: string; size: number }) {
  const { journey } = await ownJourney(input.journeyId);
  if (!isUploadConfigured()) throw new Error("File uploads are not configured. Contact your administrator.");
  if (!/[.]((jpe?g)|(png)|(webp))$/i.test(input.filename) || !["image/jpeg", "image/png", "image/webp"].includes(input.mimeType) || !Number.isFinite(input.size) || input.size <= 0 || input.size > 5 * 1024 * 1024) throw new Error("Upload a PNG, JPG or WEBP image up to 5 MB.");
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: journey.employeeId }, select: { employeeCode: true } });
  const ext = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
  const path = buildBillPath(`${employee.employeeCode}-distance-correction`, ext);
  return createSignedUploadUrl(path);
}

export async function submitDistanceCorrection(input: z.infer<typeof request>) {
  const v = request.parse(input); const { journey } = await ownJourney(v.journeyId);
  const verifiedRoute = await compareSubmittedToVerifiedRoute(
    journey.fromName ?? "",
    journey.toName ?? "",
    v.submittedDistanceKm
  );
  if (
    verifiedRoute.isVerified &&
    verifiedRoute.verifiedDistanceKm != null &&
    isRedundantVerifiedRouteCorrection(
      journey.distanceKm,
      v.submittedDistanceKm,
      verifiedRoute.verifiedDistanceKm,
      verifiedRoute.toleranceKm,
      verifiedRoute.tolerancePercent,
    )
  ) {
    return fail(
      `This trip is already recorded within tolerance of the verified ${verifiedRoute.verifiedDistanceKm} km route. No correction is needed.`,
    );
  }
  const existing = await prisma.distanceCorrection.findUnique({ where: { journeyId: v.journeyId } });
  if (existing) throw new Error(existing.status === "REJECTED" ? "This trip already has a correction request." : "Your correction is already being reviewed.");
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: journey.employeeId }, select: { employeeCode: true } });
  if (!v.screenshot.path.startsWith(`${employee.employeeCode}-distance-correction/`)) throw new Error("Upload the screenshot again before submitting.");
  const endpointDistance = journey.gpsLat != null && journey.gpsLng != null && journey.toLat != null && journey.toLng != null ? haversineMeters({ lat: journey.gpsLat, lng: journey.gpsLng }, { lat: journey.toLat, lng: journey.toLng }) : null;
  const endpointMatch = endpointDistance != null && endpointDistance <= DISTANCE_CORRECTION_CONFIG.endpointRadiusMeters;
  const usableGpsPoints = journey.gpsLat == null ? 0 : 1;
  const diff = distanceDifference(journey.distanceKm, v.submittedDistanceKm);
  // The current app stores an arrival fix, not a continuous trail. Every
  // request is therefore intentionally sent to an administrator for review.
  const decision = { status: "MANUAL_REVIEW", reason: "Submitted for admin review." } as const;
  const { routeKey } = buildRouteKey(journey.fromName ?? "", journey.toName ?? "");
  const created = await prisma.distanceCorrection.create({
    data: {
      journeyId: journey.id,
      employeeId: journey.employeeId,
      originalDistanceKm: journey.distanceKm,
      submittedDistanceKm: v.submittedDistanceKm,
      finalDistanceKm: null,
      screenshotPath: v.screenshot.path,
      screenshotName: v.screenshot.name,
      screenshotType: v.screenshot.type,
      screenshotSize: v.screenshot.size,
      differenceKm: diff.differenceKm,
      differencePercent: diff.differencePercent,
      endpointMatch,
      usableGpsPoints,
      status: decision.status,
      reviewReason: decision.reason,
      userReason: v.reason || null,
      routeKey: routeKey || null,
    },
  });
  // Staff selected through the lightweight employee picker may not have a User
  // row; never put an employee id into AuditLog.userId (a foreign key).
  await audit({
    userId: null,
    action: "CREATE",
    entity: "DistanceCorrection",
    entityId: created.id,
    meta: {
      employeeId: journey.employeeId,
      journeyId: journey.id,
      originalDistanceKm: journey.distanceKm,
      submittedDistanceKm: v.submittedDistanceKm,
      userReason: v.reason || null,
      status: created.status,
    },
  });
  revalidatePath("/app"); revalidatePath("/app/admin");
  return { ok: true as const, status: created.status };
}

export async function getDistanceCorrectionImage(id: string) {
  const row = await prisma.distanceCorrection.findUnique({ where: { id }, select: { screenshotPath: true, employeeId: true } });
  if (!row) throw new Error("Correction not found."); return createSignedDownloadUrl(row.screenshotPath, 600);
}

/** Opens evidence for its owner, or for an administrator with the existing PIN gate. */
export async function getCorrectionScreenshot(id: string) {
  const row = await prisma.distanceCorrection.findUnique({ where: { id }, select: { screenshotPath: true, employeeId: true } });
  if (!row) throw new Error("Correction not found.");
  const user = await requireUser().catch(() => null);
  if (user?.employeeId !== row.employeeId && !(await isSettingsUnlocked())) throw new Error("Not permitted.");
  return createSignedDownloadUrl(row.screenshotPath, 600);
}

export async function reviewDistanceCorrection(input: {
  id: string;
  decision: "APPROVED" | "REJECTED";
  finalDistanceKm?: number;
  note?: string;
}): Promise<
  ActionResult<{
    journeyId: string;
    originalDistanceKm: number;
    amount: number;
    thresholdMet: boolean;
    approvalCount: number;
    verifiedDistanceKm: number | null;
  }>
> {
  return attempt(async () => {
    if (!(await isSettingsUnlocked())) return fail("Admin is locked. Enter the PIN again and retry.");
    const user = await requireUser().catch(() => null);
    const final = input.finalDistanceKm;
    if (input.decision === "APPROVED" && (!Number.isFinite(final) || !final || final <= 0 || final > DISTANCE_CORRECTION_CONFIG.maxTripKm)) {
      return fail("Enter a valid approved distance.");
    }
    const settings = input.decision === "APPROVED" ? await getSettings() : null;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const correction = await tx.distanceCorrection.findUnique({
          where: { id: input.id },
          include: { journey: { select: { id: true, distanceKm: true, amount: true, vehicleType: true, fromName: true, toName: true } } },
        });
        if (!correction || !["PENDING", "AUTO_VERIFIED", "MANUAL_REVIEW"].includes(correction.status)) {
          throw new UserError("This correction was already reviewed.");
        }

        const reviewer = user
          ? await tx.user.findUnique({ where: { id: user.id }, select: { id: true } })
          : null;
        const reviewerId = reviewer?.id ?? null;
        const reviewedAt = new Date();
        const { routeKey: derivedRouteKey } = buildRouteKey(
          correction.journey.fromName ?? "",
          correction.journey.toName ?? ""
        );

        const updatedCorrection = await tx.distanceCorrection.updateMany({
          where: {
            id: correction.id,
            status: { in: ["PENDING", "AUTO_VERIFIED", "MANUAL_REVIEW"] },
          },
          data: {
            status: input.decision,
            finalDistanceKm: input.decision === "APPROVED" ? final! : null,
            adminNote: input.note?.trim() || null,
            reviewedAt,
            reviewedById: reviewerId,
            ...(derivedRouteKey ? { routeKey: derivedRouteKey } : {}),
          },
        });
        if (updatedCorrection.count !== 1) {
          throw new UserError("This correction was already reviewed.");
        }

        if (input.decision === "APPROVED") {
          const vehicleType = correction.journey.vehicleType as VehicleType;
          const amount = ["BIKE", "CAR"].includes(vehicleType)
            ? computeLegAmount(final!, vehicleType, settings!.rates)
            : correction.journey.amount;
          await tx.journey.update({
            where: { id: correction.journey.id },
            data: { distanceKm: final!, amount, distanceUpdated: true, distanceUpdatedAt: reviewedAt },
          });

          const verifiedUpdate = await processApprovedCorrection(correction.id, tx);

          const approved = {
            journeyId: correction.journey.id,
            originalDistanceKm: correction.journey.distanceKm,
            amount,
            thresholdMet: verifiedUpdate.thresholdMet,
            approvalCount: verifiedUpdate.approvalCount,
            verifiedDistanceKm: verifiedUpdate.verifiedDistanceKm,
          };
          await tx.auditLog.create({
            data: {
              userId: reviewerId,
              action: input.decision,
              entity: "DistanceCorrection",
              entityId: input.id,
              meta: JSON.stringify({
                journeyId: approved.journeyId,
                originalDistanceKm: approved.originalDistanceKm,
                finalDistanceKm: final,
                amount: approved.amount,
                thresholdMet: approved.thresholdMet,
                approvalCount: approved.approvalCount,
                verifiedDistanceKm: approved.verifiedDistanceKm,
              }),
            },
          });
          return approved;
        }
        const rejected = {
          journeyId: correction.journey.id,
          originalDistanceKm: correction.journey.distanceKm,
          amount: correction.journey.amount,
          thresholdMet: false,
          approvalCount: 0,
          verifiedDistanceKm: null as number | null,
        };
        await tx.auditLog.create({
          data: {
            userId: reviewerId,
            action: input.decision,
            entity: "DistanceCorrection",
            entityId: input.id,
            meta: JSON.stringify({
              journeyId: rejected.journeyId,
              originalDistanceKm: rejected.originalDistanceKm,
              finalDistanceKm: null,
              amount: rejected.amount,
              thresholdMet: false,
              approvalCount: 0,
              verifiedDistanceKm: null,
            }),
          },
        });
        return rejected;
      }, WRITE_TX);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (error instanceof UserError) return fail(error.message);
      if (/transaction already closed|expired transaction|timed out/i.test(message)) {
        return fail("Saving this approval took too long. Please try again.");
      }
      throw error;
    }

    revalidatePath("/app");
    revalidatePath("/app/admin");
    return ok(result);
  }, "reviewDistanceCorrection");
}

// ──────────────────────────────────────────────────────────────
// Admin Verified Route Server Actions
// ──────────────────────────────────────────────────────────────

export async function checkRouteVerifiedDistanceAction(from: string, to: string) {
  return lookupVerifiedRoute(from, to);
}

export async function manuallyVerifyRouteAction(input: {
  fromLocation: string;
  toLocation: string;
  distanceKm: number;
  notes?: string;
}) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const user = await requireUser().catch(() => null);
  const record = await manuallyVerifyRoute({
    ...input,
    adminUserId: user?.id,
  });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true, record };
}

export async function updateVerifiedDistanceAction(input: {
  id: string;
  distanceKm: number;
  notes?: string;
}) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const user = await requireUser().catch(() => null);
  const record = await updateVerifiedDistance({
    ...input,
    adminUserId: user?.id,
  });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true, record };
}

export async function setVerifiedRouteStatusAction(input: {
  id: string;
  status: "ACTIVE" | "DISABLED" | "ARCHIVED";
  reason?: string;
}) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const user = await requireUser().catch(() => null);
  const record = await setVerifiedRouteStatus({
    ...input,
    adminUserId: user?.id,
  });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true, record };
}

export async function updateVerifiedRouteConfigAction(config: Partial<VerifiedRouteConfig>) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const user = await requireUser().catch(() => null);
  const updated = await updateVerifiedRouteConfig(config, user?.id);
  revalidatePath("/app/admin");
  return { ok: true, config: updated };
}

export async function getRouteCorrectionHistoryAction(routeKey: string) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  return getRouteCorrectionHistory(routeKey);
}

export async function getCorrectionIntelligenceDataAction(filters?: {
  employeeId?: string;
  period?: string;
  fromLocation?: string;
  toLocation?: string;
  status?: string;
}) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  return getCorrectionIntelligenceData(filters);
}
