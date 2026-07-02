"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeDistance } from "@/lib/geo";
import { isValidCoord } from "@/lib/geocode";
import { getSettings } from "@/lib/settings";
import { isSettingsUnlocked } from "./settings";
import { purgeBillObject, auditBill } from "./bills";
import { todayKey } from "@/lib/utils";
import { TRAVEL_MODES, visitAmount, type TravelMode } from "@/lib/travel";

// A destination is one of three kinds:
//  - SITE:   a master Site from the configured list        (locationType MASTER)
//  - CUSTOM: a saved personal/global UserCustomLocation     (locationType CUSTOM/GPS)
//  - GPS:    a just-geolocated point not (yet) saved         (locationType GPS)
const destinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("SITE"), siteId: z.string().min(1) }),
  z.object({ kind: z.literal("CUSTOM"), customLocationId: z.string().min(1) }),
  z.object({
    kind: z.literal("GPS"),
    lat: z.number(),
    lng: z.number(),
    name: z.string().trim().min(1).max(200),
  }),
]);

const schema = z.object({
  employeeId: z.string().min(1, "Select your name."),
  destination: destinationSchema,
  mode: z.enum(TRAVEL_MODES),
  fareActual: z.number().min(0).optional(),
  // Manual distance (km) — used only when automatic calculation is unavailable.
  manualDistanceKm: z.number().positive().max(2000).optional(),
});

type Input = z.infer<typeof schema>;

// A resolved point on the map, with whichever endpoint reference applies.
interface Point {
  name: string;
  lat: number;
  lng: number;
  siteId: string | null;
  customLocationId: string | null;
  locationType: "MASTER" | "GPS" | "CUSTOM";
}

/**
 * Resolve the source for the next leg (chained journeys):
 *   - First entry of the day → the Okhla head office.
 *   - Every later entry      → the employee's last destination that day.
 * Prefers the persisted coordinate snapshot; falls back to the joined Site
 * for legs created before coordinate snapshots existed.
 */
async function resolveSource(
  employeeId: string,
  workDate: string,
  office: Point,
): Promise<{ from: Point; sequence: number }> {
  const last = await prisma.journey.findFirst({
    where: { employeeId, workDate },
    orderBy: { sequence: "desc" },
    include: { toSite: { select: { id: true, name: true, latitude: true, longitude: true } } },
  });
  if (!last) return { from: office, sequence: 0 };

  const lat = last.toLat ?? last.toSite?.latitude;
  const lng = last.toLng ?? last.toSite?.longitude;
  const from: Point = {
    name: last.toName ?? last.toSite?.name ?? "Previous location",
    lat: lat ?? office.lat,
    lng: lng ?? office.lng,
    siteId: last.toSiteId,
    customLocationId: last.toCustomLocationId,
    locationType: (last.locationType as Point["locationType"]) ?? "MASTER",
  };
  return { from, sequence: last.sequence + 1 };
}

async function resolveOffice(): Promise<Point> {
  const office = await prisma.site.findFirst({
    where: { isOffice: true },
    select: { id: true, name: true, latitude: true, longitude: true },
  });
  if (!office) throw new Error("Office location not configured.");
  return {
    name: office.name,
    lat: office.latitude,
    lng: office.longitude,
    siteId: office.id,
    customLocationId: null,
    locationType: "MASTER",
  };
}

/** Turn a destination input into a resolved Point. */
async function resolveDestination(
  dest: Input["destination"],
  employeeId: string,
): Promise<Point> {
  if (dest.kind === "SITE") {
    const site = await prisma.site.findUnique({
      where: { id: dest.siteId },
      select: { id: true, name: true, latitude: true, longitude: true, deletedAt: true },
    });
    if (!site || site.deletedAt) throw new Error("Site not found.");
    return {
      name: site.name,
      lat: site.latitude,
      lng: site.longitude,
      siteId: site.id,
      customLocationId: null,
      locationType: "MASTER",
    };
  }
  if (dest.kind === "CUSTOM") {
    const loc = await prisma.userCustomLocation.findUnique({ where: { id: dest.customLocationId } });
    if (!loc || loc.status !== "ACTIVE") throw new Error("Location not found.");
    // Personal locations are only usable by their owner (global ones by anyone).
    if (!loc.isGlobal && loc.employeeId !== employeeId) throw new Error("Location not found.");
    if (loc.latitude == null || loc.longitude == null) {
      throw new Error("This location has no coordinates; enter distance manually.");
    }
    return {
      name: loc.locationName,
      lat: loc.latitude,
      lng: loc.longitude,
      siteId: null,
      customLocationId: loc.id,
      locationType: loc.source === "GPS" ? "GPS" : "CUSTOM",
    };
  }
  // GPS — an unsaved geolocated point.
  if (!isValidCoord(dest.lat, dest.lng)) throw new Error("Invalid coordinates.");
  return {
    name: dest.name,
    lat: dest.lat,
    lng: dest.lng,
    siteId: null,
    customLocationId: null,
    locationType: "GPS",
  };
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

async function computeLeg(from: Point, to: Point, manualDistanceKm: number | undefined) {
  if (typeof manualDistanceKm === "number" && manualDistanceKm > 0) {
    return {
      distanceKm: manualDistanceKm,
      roadKm: manualDistanceKm,
      haversineKm: manualDistanceKm,
      durationMin: null as number | null,
      source: "MANUAL" as const,
    };
  }
  const d = await computeDistance({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
  return { ...d, durationMin: d.durationMin as number | null };
}

/** Preview the next leg without persisting — powers the live estimate on the form. */
export async function previewVisit(input: Input) {
  const { employeeId, destination, mode, fareActual, manualDistanceKm } = schema.parse(input);
  const office = await resolveOffice();
  const [{ from }, to] = await Promise.all([
    resolveSource(employeeId, todayKey(), office),
    resolveDestination(destination, employeeId),
  ]);

  const sameSite = to.siteId && from.siteId === to.siteId;
  const sameCustom = to.customLocationId && from.customLocationId === to.customLocationId;
  if (sameSite || sameCustom) {
    return { fromName: from.name, toName: to.name, km: 0, amount: 0, alreadyHere: true };
  }

  const dist = await computeLeg(from, to, manualDistanceKm);
  const settings = await getSettings();
  const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);
  return {
    fromName: from.name,
    toName: to.name,
    km: dist.distanceKm,
    amount,
    durationMin: dist.durationMin,
    source: dist.source,
    alreadyHere: false,
  };
}

/** Log one leg. Source is auto-resolved; distance & amount computed server-side. */
export async function logVisit(input: Input) {
  const { employeeId, destination, mode, fareActual, manualDistanceKm } = schema.parse(input);

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.deletedAt) throw new Error("Employee not found.");

  const office = await resolveOffice();
  const workDate = todayKey();
  const [{ from, sequence }, to] = await Promise.all([
    resolveSource(employeeId, workDate, office),
    resolveDestination(destination, employeeId),
  ]);

  const sameSite = to.siteId && from.siteId === to.siteId;
  const sameCustom = to.customLocationId && from.customLocationId === to.customLocationId;
  if (sameSite || sameCustom) {
    throw new Error(`You are already at ${to.name}. Pick a different destination.`);
  }

  const dist = await computeLeg(from, to, manualDistanceKm);
  const settings = await getSettings();
  const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);

  await prisma.journey.create({
    data: {
      employeeId,
      workDate,
      fromSiteId: from.siteId,
      toSiteId: to.siteId,
      fromCustomLocationId: from.customLocationId,
      toCustomLocationId: to.customLocationId,
      fromName: from.name,
      toName: to.name,
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
      locationType: to.locationType,
      manualDistance: dist.source === "MANUAL",
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
  return { ok: true, km: dist.distanceKm, amount, from: from.name, site: to.name, employee: employee.name };
}

/** Remove a logged visit (Admin/correction). Gated by the admin PIN unlock. */
export async function deleteVisit(id: string) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  const existing = await prisma.journey.findUnique({ where: { id }, select: { billPath: true } });
  await prisma.journey.delete({ where: { id } });
  await purgeBillObject(existing?.billPath); // prevent orphaned storage
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}

const journeyBillSchema = z.object({
  journeyId: z.string().min(1),
  employeeId: z.string().min(1),
  bill: z.object({
    path: z.string().min(1),
    name: z.string().min(1).max(200),
    type: z.string().min(1).max(100),
    size: z.number().int().positive(),
  }),
});

/** Attach (or replace) a bill on a conveyance leg — by the owning employee. */
export async function attachJourneyBill(input: z.infer<typeof journeyBillSchema>) {
  const { journeyId, employeeId, bill } = journeyBillSchema.parse(input);
  const journey = await prisma.journey.findUnique({ where: { id: journeyId }, select: { employeeId: true, billPath: true } });
  if (!journey || journey.employeeId !== employeeId) throw new Error("Entry not found.");
  if (journey.billPath && journey.billPath !== bill.path) await purgeBillObject(journey.billPath);
  await prisma.journey.update({
    where: { id: journeyId },
    data: {
      billPath: bill.path, billName: bill.name, billType: bill.type, billSize: bill.size,
      billUploadedAt: new Date(), billUploadedBy: employeeId,
    },
  });
  await auditBill({ employeeId, action: journey.billPath ? "BILL_REPLACE" : "BILL_UPLOAD", entity: "Journey", entityId: journeyId, path: bill.path });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}

/** Remove a conveyance leg's bill — by the owning employee. */
export async function removeJourneyBill(journeyId: string, employeeId: string) {
  const journey = await prisma.journey.findUnique({ where: { id: journeyId }, select: { employeeId: true, billPath: true } });
  if (!journey || journey.employeeId !== employeeId) throw new Error("Entry not found.");
  if (journey.billPath) await purgeBillObject(journey.billPath);
  await prisma.journey.update({
    where: { id: journeyId },
    data: { billPath: null, billName: null, billType: null, billSize: null, billUploadedAt: null, billUploadedBy: null },
  });
  await auditBill({ employeeId, action: "BILL_DELETE", entity: "Journey", entityId: journeyId, path: journey.billPath });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}
