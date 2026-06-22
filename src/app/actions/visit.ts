"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeDistance } from "@/lib/geo";
import { getSettings } from "@/lib/settings";
import { todayKey } from "@/lib/utils";
import { TRAVEL_MODES, visitAmount, type TravelMode } from "@/lib/travel";

const schema = z.object({
  employeeId: z.string().min(1, "Select your name."),
  siteId: z.string().min(1, "Select the site."),
  mode: z.enum(TRAVEL_MODES),
  // Optional actual ticket fare — only used for Bus/Metro. When provided (>0),
  // it overrides the per-km estimate.
  fareActual: z.number().min(0).optional(),
});

interface SitePoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/**
 * Resolve the source for the next leg of an employee's day.
 *
 * Business rule (chained journeys):
 *   - First entry of the day  →  from = Okhla head office.
 *   - Every later entry       →  from = the employee's last punched site.
 *
 * The user never picks the source; it is always the previous destination.
 */
async function resolveSource(
  employeeId: string,
  workDate: string,
  office: SitePoint,
): Promise<{ from: SitePoint; sequence: number }> {
  const last = await prisma.journey.findFirst({
    where: { employeeId, workDate },
    orderBy: { sequence: "desc" },
    include: { toSite: { select: { id: true, name: true, latitude: true, longitude: true } } },
  });
  if (!last) return { from: office, sequence: 0 };
  return { from: last.toSite, sequence: last.sequence + 1 };
}

function legAmount(
  distanceKm: number,
  mode: TravelMode,
  fareActual: number | undefined,
  rates: Awaited<ReturnType<typeof getSettings>>["rates"],
): number {
  const useActual = mode === "BUSMETRO" && typeof fareActual === "number" && fareActual > 0;
  return useActual ? Math.round(fareActual! * 100) / 100 : visitAmount(distanceKm, mode, rates);
}

/**
 * Compute the next leg without persisting it — used to show the employee an
 * accurate "from → to" preview on the Check In form before they submit.
 */
export async function previewVisit(input: z.infer<typeof schema>) {
  const { employeeId, siteId, mode, fareActual } = schema.parse(input);
  const [site, office] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true, latitude: true, longitude: true } }),
    prisma.site.findFirst({ where: { isOffice: true }, select: { id: true, name: true, latitude: true, longitude: true } }),
  ]);
  if (!site || !office) return null;

  const { from } = await resolveSource(employeeId, todayKey(), office);
  if (from.id === site.id) {
    return { fromName: from.name, toName: site.name, km: 0, amount: 0, alreadyHere: true };
  }
  const dist = await computeDistance(
    { lat: from.latitude, lng: from.longitude },
    { lat: site.latitude, lng: site.longitude },
  );
  const settings = await getSettings();
  const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);
  return { fromName: from.name, toName: site.name, km: dist.distanceKm, amount, alreadyHere: false };
}

/**
 * Log one site visit. The source is resolved automatically from the employee's
 * last punched site that day (Okhla office on the first entry). Distance and
 * amount are computed server-side; no manual KM entry. Stored as one Journey leg.
 */
export async function logVisit(input: z.infer<typeof schema>) {
  const { employeeId, siteId, mode, fareActual } = schema.parse(input);

  const [employee, site, office] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.site.findUnique({ where: { id: siteId } }),
    prisma.site.findFirst({ where: { isOffice: true } }),
  ]);
  if (!employee || employee.deletedAt) throw new Error("Employee not found.");
  if (!site || site.deletedAt) throw new Error("Site not found.");
  if (!office) throw new Error("Office location not configured.");

  const workDate = todayKey();
  const { from, sequence } = await resolveSource(employeeId, workDate, office);
  if (from.id === site.id) {
    throw new Error(`You are already at ${site.name}. Pick a different site.`);
  }

  const dist = await computeDistance(
    { lat: from.latitude, lng: from.longitude },
    { lat: site.latitude, lng: site.longitude },
  );
  const settings = await getSettings();
  const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);

  await prisma.journey.create({
    data: {
      employeeId,
      workDate,
      fromSiteId: from.id,
      toSiteId: site.id,
      sequence,
      distanceKm: dist.distanceKm,
      roadKm: dist.roadKm,
      haversineKm: dist.haversineKm,
      durationMin: dist.durationMin,
      source: dist.source,
      vehicleType: mode,
      amount,
    },
  });

  revalidatePath("/app");
  return {
    ok: true,
    km: dist.distanceKm,
    amount,
    from: from.name,
    site: site.name,
    employee: employee.name,
  };
}

/** Remove a logged visit (Admin/correction). */
export async function deleteVisit(id: string) {
  await prisma.journey.delete({ where: { id } });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}
