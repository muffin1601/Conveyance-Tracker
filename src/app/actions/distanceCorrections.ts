"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildBillPath, createSignedDownloadUrl, createSignedUploadUrl, isUploadConfigured } from "@/lib/storage";
import { distanceDifference, DISTANCE_CORRECTION_CONFIG, verificationDecision } from "@/lib/distanceCorrection";
import { haversineMeters } from "@/lib/gps";
import { isSettingsUnlocked } from "./settings";

const image = z.object({ path: z.string().min(1), name: z.string().min(1).max(200), type: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().positive().max(5 * 1024 * 1024) });
const request = z.object({ journeyId: z.string().min(1), submittedDistanceKm: z.number().finite().positive().max(DISTANCE_CORRECTION_CONFIG.maxTripKm), screenshot: image });

async function ownJourney(journeyId: string) {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("Please select your name first.");
  const journey = await prisma.journey.findUnique({ where: { id: journeyId }, select: { id: true, employeeId: true, distanceKm: true, gpsLat: true, gpsLng: true, toLat: true, toLng: true, gpsDistanceM: true } });
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
  const v = request.parse(input); const { user, journey } = await ownJourney(v.journeyId);
  const existing = await prisma.distanceCorrection.findUnique({ where: { journeyId: v.journeyId } });
  if (existing) throw new Error(existing.status === "REJECTED" ? "This trip already has a correction request." : "Your correction is already being reviewed.");
  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: journey.employeeId }, select: { employeeCode: true } });
  if (!v.screenshot.path.startsWith(`${employee.employeeCode}-distance-correction/`)) throw new Error("Upload the screenshot again before submitting.");
  const endpointDistance = journey.gpsLat != null && journey.gpsLng != null && journey.toLat != null && journey.toLng != null ? haversineMeters({ lat: journey.gpsLat, lng: journey.gpsLng }, { lat: journey.toLat, lng: journey.toLng }) : null;
  const endpointMatch = endpointDistance != null && endpointDistance <= DISTANCE_CORRECTION_CONFIG.endpointRadiusMeters;
  const usableGpsPoints = journey.gpsLat == null ? 0 : 1;
  const diff = distanceDifference(journey.distanceKm, v.submittedDistanceKm);
  const decision = verificationDecision({ differencePercent: diff.differencePercent, endpointMatch, usableGpsPoints, hasScreenshot: true });
  const created = await prisma.distanceCorrection.create({ data: { journeyId: journey.id, employeeId: journey.employeeId, originalDistanceKm: journey.distanceKm, submittedDistanceKm: v.submittedDistanceKm, finalDistanceKm: decision.status === "AUTO_VERIFIED" ? v.submittedDistanceKm : null, screenshotPath: v.screenshot.path, screenshotName: v.screenshot.name, screenshotType: v.screenshot.type, screenshotSize: v.screenshot.size, differenceKm: diff.differenceKm, differencePercent: diff.differencePercent, endpointMatch, usableGpsPoints, status: decision.status, reviewReason: decision.reason } });
  await audit({ userId: user.id, action: "CREATE", entity: "DistanceCorrection", entityId: created.id, meta: { journeyId: journey.id, originalDistanceKm: journey.distanceKm, submittedDistanceKm: v.submittedDistanceKm, status: created.status } });
  revalidatePath("/app"); revalidatePath("/app/admin");
  return { status: created.status };
}

export async function getDistanceCorrectionImage(id: string) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const row = await prisma.distanceCorrection.findUnique({ where: { id }, select: { screenshotPath: true } });
  if (!row) throw new Error("Correction not found."); return createSignedDownloadUrl(row.screenshotPath, 600);
}

export async function reviewDistanceCorrection(input: { id: string; decision: "APPROVED" | "REJECTED"; finalDistanceKm?: number; note?: string }) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const final = input.finalDistanceKm;
  if (input.decision === "APPROVED" && (!Number.isFinite(final) || !final || final <= 0 || final > DISTANCE_CORRECTION_CONFIG.maxTripKm)) throw new Error("Enter a valid approved distance.");
  const updated = await prisma.distanceCorrection.updateMany({ where: { id: input.id, status: { in: ["PENDING", "AUTO_VERIFIED", "MANUAL_REVIEW"] } }, data: { status: input.decision, finalDistanceKm: input.decision === "APPROVED" ? final! : null, adminNote: input.note?.trim() || null, reviewedAt: new Date() } });
  if (updated.count !== 1) throw new Error("This correction was already reviewed.");
  await audit({ action: input.decision, entity: "DistanceCorrection", entityId: input.id, meta: { finalDistanceKm: final ?? null } });
  revalidatePath("/app"); revalidatePath("/app/admin"); return { ok: true };
}
