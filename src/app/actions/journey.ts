"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import { computeDistance, isWithinGeofence } from "@/lib/geo";
import { computeLegAmount } from "@/lib/conveyance";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/utils";
import type { VehicleType } from "@/lib/enums";

const punchInSchema = z.object({
  siteId: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().optional(),
});

/** Resolve the Employee record for the current user (must exist). */
async function currentEmployee() {
  const user = await requireUser();
  if (!user.employeeId) throw new Error("No employee profile linked to this account.");
  const employee = await prisma.employee.findUnique({ where: { id: user.employeeId } });
  if (!employee) throw new Error("Employee profile not found.");
  return { user, employee };
}

/**
 * Punch in at a site.
 * Server-authoritative GPS validation: distance from site centroid must be
 * within the site geofence radius. A journey leg is created from the
 * employee's previous location (office on first leg) to this site, with
 * distance + reimbursement computed server-side. No manual KM entry.
 */
export async function punchIn(input: z.infer<typeof punchInSchema>) {
  const { siteId, lat, lng, accuracy } = punchInSchema.parse(input);
  const { user, employee } = await currentEmployee();
  const workDate = todayKey();

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site || site.deletedAt) throw new Error("Site not found.");

  // Block double-open visits.
  const open = await prisma.siteVisit.findFirst({
    where: { employeeId: employee.id, status: "OPEN" },
  });
  if (open) throw new Error("You already have an open visit. Punch out first.");

  // ── GPS validation (server authoritative) ──────────────
  const geo = isWithinGeofence(
    { lat, lng },
    { lat: site.latitude, lng: site.longitude },
    site.geofenceRadius,
  );
  if (!geo.ok) {
    throw new Error(
      `You are not near ${site.name} (${Math.round(geo.distance)}m away, allowed ${site.geofenceRadius}m).`,
    );
  }

  // ── Determine origin of this leg ────────────────────────
  // The last site visited today, else the office.
  const lastVisit = await prisma.siteVisit.findFirst({
    where: { employeeId: employee.id, workDate },
    orderBy: { checkInAt: "desc" },
    include: { site: true },
  });
  const office = await prisma.site.findFirst({ where: { isOffice: true } });
  if (!office) throw new Error("Office location not configured.");
  const fromSite = lastVisit?.site ?? office;

  const sequence = await prisma.journey.count({ where: { employeeId: employee.id, workDate } });

  const dist = await computeDistance(
    { lat: fromSite.latitude, lng: fromSite.longitude },
    { lat: site.latitude, lng: site.longitude },
  );
  const settings = await getSettings();
  const vehicleType = employee.vehicleType as VehicleType;
  const amount = computeLegAmount(dist.distanceKm, vehicleType, settings.rates);

  const hdrs = await headers();
  const result = await prisma.$transaction(async (tx) => {
    const visit = await tx.siteVisit.create({
      data: {
        employeeId: employee.id,
        siteId: site.id,
        workDate,
        inLatitude: lat,
        inLongitude: lng,
        inAccuracy: accuracy ?? null,
        inDistance: geo.distance,
        deviceInfo: hdrs.get("user-agent") ?? null,
        ipAddress: hdrs.get("x-forwarded-for") ?? null,
        status: "OPEN",
      },
    });
    await tx.journey.create({
      data: {
        employeeId: employee.id,
        workDate,
        fromSiteId: fromSite.id,
        toSiteId: site.id,
        sequence,
        distanceKm: dist.distanceKm,
        roadKm: dist.roadKm,
        haversineKm: dist.haversineKm,
        durationMin: dist.durationMin,
        source: dist.source,
        vehicleType,
        amount,
        arrivalVisitId: visit.id,
      },
    });
    return visit;
  });

  await audit({
    userId: user.id,
    action: "PUNCH_IN",
    entity: "SiteVisit",
    entityId: result.id,
    meta: { site: site.name, from: fromSite.name, km: dist.distanceKm, amount },
  });

  revalidatePath("/app");
  return { ok: true, distanceKm: dist.distanceKm, amount, from: fromSite.name };
}

/** Punch out of the currently open visit. Computes duration. */
export async function punchOut(input: { lat?: number; lng?: number; accuracy?: number }) {
  const { user, employee } = await currentEmployee();
  const open = await prisma.siteVisit.findFirst({
    where: { employeeId: employee.id, status: "OPEN" },
  });
  if (!open) throw new Error("No open visit to punch out.");

  const now = new Date();
  const durationMin = Math.max(0, Math.round((now.getTime() - open.checkInAt.getTime()) / 60000));

  await prisma.siteVisit.update({
    where: { id: open.id },
    data: {
      checkOutAt: now,
      outLatitude: input.lat ?? null,
      outLongitude: input.lng ?? null,
      outAccuracy: input.accuracy ?? null,
      durationMin,
      status: "CLOSED",
    },
  });

  await audit({
    userId: user.id,
    action: "PUNCH_OUT",
    entity: "SiteVisit",
    entityId: open.id,
    meta: { durationMin },
  });

  revalidatePath("/app");
  return { ok: true, durationMin };
}

/**
 * End day: returns to office as a final leg (no punch), closing any open visit
 * and recording the return trip distance/amount.
 */
export async function endDay() {
  const { user, employee } = await currentEmployee();
  const workDate = todayKey();
  const office = await prisma.site.findFirst({ where: { isOffice: true } });
  if (!office) throw new Error("Office not configured.");

  const open = await prisma.siteVisit.findFirst({
    where: { employeeId: employee.id, status: "OPEN" },
    include: { site: true },
  });
  if (open) {
    await punchOut({});
  }

  const lastVisit = await prisma.siteVisit.findFirst({
    where: { employeeId: employee.id, workDate },
    orderBy: { checkInAt: "desc" },
    include: { site: true },
  });
  if (!lastVisit) throw new Error("No visits logged today.");

  // Avoid duplicate return legs.
  const existingReturn = await prisma.journey.findFirst({
    where: { employeeId: employee.id, workDate, toSiteId: office.id, fromSiteId: lastVisit.site.id },
  });
  if (existingReturn) {
    revalidatePath("/app");
    return { ok: true, already: true };
  }

  const sequence = await prisma.journey.count({ where: { employeeId: employee.id, workDate } });
  const dist = await computeDistance(
    { lat: lastVisit.site.latitude, lng: lastVisit.site.longitude },
    { lat: office.latitude, lng: office.longitude },
  );
  const settings = await getSettings();
  const vehicleType = employee.vehicleType as VehicleType;
  const amount = computeLegAmount(dist.distanceKm, vehicleType, settings.rates);

  await prisma.journey.create({
    data: {
      employeeId: employee.id,
      workDate,
      fromSiteId: lastVisit.site.id,
      toSiteId: office.id,
      sequence,
      distanceKm: dist.distanceKm,
      roadKm: dist.roadKm,
      haversineKm: dist.haversineKm,
      durationMin: dist.durationMin,
      source: dist.source,
      vehicleType,
      amount,
    },
  });

  await audit({ userId: user.id, action: "END_DAY", entity: "Journey", meta: { returnKm: dist.distanceKm } });
  void notify; // reminders wired in cron
  revalidatePath("/app");
  return { ok: true, returnKm: dist.distanceKm, amount };
}
