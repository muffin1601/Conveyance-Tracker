"use server";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  isUploadConfigured,
  validateBillMeta,
  buildBillPath,
  createSignedUploadUrl,
  createSignedDownloadUrl,
  deleteObject,
} from "@/lib/storage";

export interface UploadTicket {
  path: string;
  uploadUrl: string;
}

/**
 * Step 1 of an upload: validate the intended file and mint a one-time signed
 * upload URL scoped to a server-chosen path (employeeCode/YYYY/MM/uuid.ext).
 * Employee-initiated only — the admin panel never calls this.
 */
export async function requestBillUpload(input: {
  employeeId: string;
  filename: string;
  mimeType: string;
  size: number;
}): Promise<UploadTicket> {
  if (!isUploadConfigured()) {
    throw new Error("File uploads are not configured. Contact your administrator.");
  }
  const { employeeId, filename, mimeType, size } = input;
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeCode: true, deletedAt: true, status: true },
  });
  if (!employee || employee.deletedAt || employee.status !== "ACTIVE") {
    throw new Error("Employee not found.");
  }
  const ext = validateBillMeta({ filename, mimeType, size });
  const path = buildBillPath(employee.employeeCode, ext);
  return createSignedUploadUrl(path);
}

/**
 * Return a short-lived signed URL to view/download a bill. Used by both the
 * owning employee and admins (admins may view/download any bill).
 */
export async function getBillUrl(entity: "misc" | "conveyance", id: string): Promise<string> {
  const path =
    entity === "misc"
      ? (await prisma.miscellaneousExpense.findUnique({ where: { id }, select: { billPath: true } }))?.billPath
      : (await prisma.journey.findUnique({ where: { id }, select: { billPath: true } }))?.billPath;
  if (!path) throw new Error("No bill attached.");
  return createSignedDownloadUrl(path, 3600);
}

/**
 * Discard an object that was uploaded but never saved (e.g. the employee
 * cancelled the form). Path ownership is verified against the employee's code
 * prefix to prevent deleting someone else's file.
 */
export async function discardBill(employeeId: string, path: string): Promise<{ ok: boolean }> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { employeeCode: true },
  });
  if (!employee) throw new Error("Employee not found.");
  const prefix = employee.employeeCode.replace(/[^A-Za-z0-9_-]/g, "");
  if (!path.startsWith(`${prefix}/`)) throw new Error("Not permitted.");
  // Only discard if no saved row references this path (avoid nuking a live bill).
  const [inMisc, inJourney] = await Promise.all([
    prisma.miscellaneousExpense.count({ where: { billPath: path } }),
    prisma.journey.count({ where: { billPath: path } }),
  ]);
  if (inMisc === 0 && inJourney === 0) await deleteObject(path);
  return { ok: true };
}

/** Internal helper for delete/replace cascades (not a form action wrapper). */
export async function purgeBillObject(path: string | null | undefined): Promise<void> {
  if (path) await deleteObject(path);
}

/** Audit a bill lifecycle event. */
export async function auditBill(params: {
  employeeId: string | null;
  action: "BILL_UPLOAD" | "BILL_REPLACE" | "BILL_DELETE";
  entity: "MiscellaneousExpense" | "Journey";
  entityId: string;
  path: string | null;
}): Promise<void> {
  // NOTE: AuditLog.userId is an FK to User — employees are NOT Users in this
  // app, so the actor is recorded in meta (employeeId), never as userId.
  await audit({
    userId: null,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId,
    meta: { employeeId: params.employeeId, path: params.path },
  });
}

/** Whether bill uploads are configured (server env present). */
export async function uploadsEnabled(): Promise<boolean> {
  return isUploadConfigured();
}
