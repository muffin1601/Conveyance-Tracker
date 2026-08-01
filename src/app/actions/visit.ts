"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { memo } from "@/lib/cache";
import { computeDistance, haversineMeters } from "@/lib/geo";
import { isValidCoord } from "@/lib/geocode";
import { legFromName, legToName } from "@/lib/journeyEndpoint";
import { attempt, ok, fail, type ActionResult } from "@/lib/result";
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
  fareActual: z.number().min(0).max(100_000, "Fare looks too large — check the amount.").optional(),
  // Manual distance (km) — used only when automatic calculation is unavailable.
  manualDistanceKm: z
    .number()
    .positive("Distance must be greater than 0 km.")
    .max(2000, "Distance must be 2,000 km or less.")
    .optional(),
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
 * The last leg that still counts towards today's chain, plus the reset marker.
 * Fetched as one round-trip pair so callers can run it alongside the office
 * and destination lookups instead of after them.
 */
async function loadChainTail(employeeId: string, workDate: string) {
  const [last, reset] = await Promise.all([
    prisma.journey.findFirst({
      where: { employeeId, workDate },
      orderBy: { sequence: "desc" },
      include: { toSite: { select: { id: true, name: true, latitude: true, longitude: true } } },
    }),
    prisma.journeyReset.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
      select: { afterSequence: true },
    }),
  ]);
  // A leg at or below the reset point no longer chains — the next trip starts
  // from the office again — but it stays in history, reports and exports.
  const chained = last && (!reset || last.sequence > reset.afterSequence) ? last : null;
  return { last, chained };
}

type ChainTail = Awaited<ReturnType<typeof loadChainTail>>;

/**
 * Resolve the source for the next leg (chained journeys):
 *   - First entry of the day (or first after a reset) → the head office.
 *   - Every later entry → the employee's previous destination.
 * Prefers the persisted coordinate snapshot; falls back to the joined Site
 * for legs created before coordinate snapshots existed.
 */
function resolveSource(tail: ChainTail, office: Point): { from: Point; sequence: number } {
  const { last, chained } = tail;
  // `sequence` always continues from the highest leg of the day so a reset can
  // never collide with an existing row's ordering.
  const sequence = last ? last.sequence + 1 : 0;
  if (!chained) return { from: office, sequence };

  const lat = chained.toLat ?? chained.toSite?.latitude;
  const lng = chained.toLng ?? chained.toSite?.longitude;
  const from: Point = {
    name: chained.toName ?? chained.toSite?.name ?? "Previous location",
    lat: lat ?? office.lat,
    lng: lng ?? office.lng,
    siteId: chained.toSiteId,
    customLocationId: chained.toCustomLocationId,
    locationType: (chained.locationType as Point["locationType"]) ?? "MASTER",
  };
  return { from, sequence };
}

function siteToPoint(site: { id: string; name: string; latitude: number; longitude: number }): Point {
  return {
    name: site.name,
    lat: site.latitude,
    lng: site.longitude,
    siteId: site.id,
    customLocationId: null,
    locationType: "MASTER" as const,
  };
}

/**
 * The head office. Everyone's fallback origin. Memoised for 5 minutes — it is
 * read on every preview and every logged visit but changes roughly never, and
 * each read is a ~450 ms hop.
 */
async function resolveOffice(): Promise<Point> {
  return memo("site:office", 5 * 60_000, async () => {
    const office = await prisma.site.findFirst({
      where: { isOffice: true },
      select: { id: true, name: true, latitude: true, longitude: true },
    });
    if (!office) throw new Error("Office location not configured. Ask an admin to set it up.");
    return siteToPoint(office);
  });
}

/**
 * Where this employee's day starts. Most people start at the head office;
 * an employee can be assigned a different starting-point site instead (e.g.
 * staff working out of the showroom) via Settings → Staff. Falls back to the
 * head office if no override is set, the assigned site was deactivated, or it
 * lost its starting-point flag.
 */
async function resolveDefaultOrigin(employeeId: string): Promise<Point> {
  return memo(`origin:${employeeId}`, 5 * 60_000, async () => {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        defaultOriginSite: {
          select: {
            id: true, name: true, latitude: true, longitude: true,
            status: true, isStartingPoint: true, isOffice: true, deletedAt: true,
          },
        },
      },
    });
    const site = emp?.defaultOriginSite;
    if (site && site.status === "ACTIVE" && !site.deletedAt && (site.isStartingPoint || site.isOffice)) {
      return siteToPoint(site);
    }
    return resolveOffice();
  });
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

/**
 * Same-place guard. Two endpoints are "the same" when they reference the same
 * master site, the same saved location, or — for ad-hoc GPS points, which have
 * no id to compare — sit within 50 m of each other.
 */
function isSamePlace(from: Point, to: Point): boolean {
  if (to.siteId && from.siteId === to.siteId) return true;
  if (to.customLocationId && from.customLocationId === to.customLocationId) return true;
  return haversineMeters({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }) < 50;
}

/**
 * Everything a leg needs, resolved concurrently. Previously these ran one
 * after another — office, then source, then destination, then settings — for
 * four serial ~450 ms round-trips before the distance lookup had even started.
 */
async function resolveLegContext(
  employeeId: string,
  workDate: string,
  destination: Input["destination"],
) {
  const [origin, tail, to, settings] = await Promise.all([
    resolveDefaultOrigin(employeeId),
    loadChainTail(employeeId, workDate),
    resolveDestination(destination, employeeId),
    getSettings(),
  ]);
  const { from, sequence } = resolveSource(tail, origin);
  return { from, to, sequence, settings, lastLeg: tail.last, isFirstLeg: !tail.chained };
}

/** A repeat of the previous leg within this window is treated as a double submit. */
const DUPLICATE_WINDOW_MS = 60_000;

/** Preview the next leg without persisting — powers the live estimate on the form. */
export async function previewVisit(input: Input) {
  const { employeeId, destination, mode, fareActual, manualDistanceKm } = schema.parse(input);
  const workDate = todayKey();
  const { from, to, sequence, settings } = await resolveLegContext(employeeId, workDate, destination);

  if (isSamePlace(from, to)) {
    return {
      fromName: from.name, toName: to.name, km: 0, amount: 0,
      tripNumber: sequence + 1, alreadyHere: true,
    };
  }

  const dist = await computeLeg(from, to, manualDistanceKm);
  const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);
  return {
    fromName: from.name,
    toName: to.name,
    km: dist.distanceKm,
    amount,
    durationMin: dist.durationMin,
    source: dist.source,
    tripNumber: sequence + 1,
    alreadyHere: false,
  };
}

/** Log one leg. Source is auto-resolved; distance & amount computed server-side. */
export async function logVisit(input: Input) {
  const { employeeId, destination, mode, fareActual, manualDistanceKm } = schema.parse(input);
  const workDate = todayKey();

  const [employee, ctx] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, status: true, deletedAt: true },
    }),
    resolveLegContext(employeeId, workDate, destination),
  ]);
  if (!employee || employee.deletedAt) throw new Error("Employee not found.");
  if (employee.status !== "ACTIVE") throw new Error("This employee is no longer active.");

  const { from, to, sequence, settings, lastLeg } = ctx;
  if (isSamePlace(from, to)) {
    throw new Error(`You are already at ${to.name}. Pick a different destination.`);
  }

  // Duplicate guard: the same leg logged twice within a minute is a double
  // submit (a second tab, a retried request, an impatient double tap), not a
  // real second trip. The client also disables its button, but that cannot
  // protect against a request that arrives from somewhere else.
  if (
    lastLeg &&
    lastLeg.toName === to.name &&
    lastLeg.fromName === from.name &&
    Date.now() - lastLeg.createdAt.getTime() < DUPLICATE_WINDOW_MS
  ) {
    throw new Error(
      `This trip (${from.name} → ${to.name}) was just logged. Refresh to see it.`,
    );
  }

  const dist = await computeLeg(from, to, manualDistanceKm);
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
  return {
    ok: true,
    km: dist.distanceKm,
    amount,
    from: from.name,
    site: to.name,
    employee: employee.name,
    tripNumber: sequence + 1,
  };
}

// ── Journey state (Issue 3 / 4) ───────────────────────────────────────────

export interface JourneyState {
  /** 1-based number of the trip the employee is about to log. */
  tripNumber: number;
  /** Where the next trip starts. Read-only unless this is the first trip. */
  fromName: string;
  /** True when the next leg starts at the office (day start, or after a reset). */
  atOrigin: boolean;
  totalKm: number;
  totalAmount: number;
  /** Today's legs, oldest first — the trip timeline. */
  legs: {
    id: string;
    sequence: number;
    fromName: string;
    toName: string;
    distanceKm: number;
    amount: number;
    mode: string;
    /** False for legs that were superseded by a "Reset Journey". */
    chained: boolean;
    at: Date;
  }[];
}

/**
 * Everything the visit screen needs about today's journey, in one round-trip:
 * the next trip number, its (auto-resolved) starting point, the running
 * totals, and the timeline of trips already logged.
 */
export async function getJourneyState(employeeId: string): Promise<JourneyState | null> {
  if (!employeeId) return null;
  const workDate = todayKey();

  const [origin, legs, reset] = await Promise.all([
    resolveDefaultOrigin(employeeId),
    prisma.journey.findMany({
      where: { employeeId, workDate },
      orderBy: { sequence: "asc" },
      select: {
        id: true, sequence: true, fromName: true, toName: true,
        distanceKm: true, amount: true, vehicleType: true, createdAt: true,
        fromSite: { select: { name: true } },
        toSite: { select: { name: true } },
        fromCustomLocation: { select: { locationName: true } },
        toCustomLocation: { select: { locationName: true } },
      },
    }),
    prisma.journeyReset.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
      select: { afterSequence: true },
    }),
  ]);

  const last = legs.length ? legs[legs.length - 1] : null;
  const chainedTail = last && (!reset || last.sequence > reset.afterSequence) ? last : null;

  return {
    tripNumber: (last ? last.sequence + 1 : 0) + 1,
    fromName: chainedTail ? legToName(chainedTail) : origin.name,
    atOrigin: !chainedTail,
    totalKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    totalAmount: legs.reduce((s, l) => s + l.amount, 0),
    legs: legs.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      fromName: legFromName(l),
      toName: legToName(l),
      distanceKm: l.distanceKm,
      amount: l.amount,
      mode: l.vehicleType,
      chained: !reset || l.sequence > reset.afterSequence,
      at: l.createdAt,
    })),
  };
}

/**
 * Manually restart the day's chain. The next trip starts from the head office
 * again; already-logged legs are left exactly as they are, so distances,
 * fares, history, reports and exports are all unaffected.
 */
export async function resetJourney(employeeId: string): Promise<ActionResult> {
  return attempt(async () => {
  if (!employeeId) return fail("Select your name first.");
  const workDate = todayKey();

  const last = await prisma.journey.findFirst({
    where: { employeeId, workDate },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  // -1 when nothing is logged yet: the chain is already at the office, and the
  // marker still records the intent so the UI can confirm it.
  const afterSequence = last?.sequence ?? -1;

    await prisma.journeyReset.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: { employeeId, workDate, afterSequence },
      update: { afterSequence },
    });

    revalidatePath("/app");
    return ok();
  }, "resetJourney");
}

/**
 * Remove a logged visit (Admin/correction). Gated by the admin PIN unlock.
 *
 * A Journey can be referenced by a ClaimItem, and that relation has no
 * `onDelete` rule — so Prisma defaults to Restrict and the delete used to fail
 * with a raw foreign-key error. Because the caller swallowed errors, that
 * surfaced as "the delete button does nothing". The claim row is now removed
 * with the leg inside one transaction, unless the claim has already been
 * approved or paid — in which case deleting would silently change a settled
 * amount, and the admin is told to reopen the claim instead.
 */
export async function deleteVisit(id: string): Promise<ActionResult> {
  return attempt(async () => {
    if (!(await isSettingsUnlocked())) {
      return fail("Admin is locked. Enter the PIN again and retry.");
    }

    const existing = await prisma.journey.findUnique({
      where: { id },
      select: {
        billPath: true,
        claimItem: { select: { id: true, claim: { select: { status: true, periodMonth: true } } } },
      },
    });
    if (!existing) return fail("That entry no longer exists — it may already have been deleted.");

    const claim = existing.claimItem?.claim;
    const LOCKED_CLAIM = ["MANAGER_APPROVED", "ADMIN_APPROVED", "FINANCE_APPROVED", "PAID"];
    if (claim && LOCKED_CLAIM.includes(claim.status)) {
      return fail(
        `This trip is part of the ${claim.periodMonth} claim, which is already ` +
        `${claim.status.replace(/_/g, " ").toLowerCase()}. Reopen that claim before deleting the trip.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      if (existing.claimItem) await tx.claimItem.delete({ where: { id: existing.claimItem.id } });
      await tx.journey.delete({ where: { id } });
    });

    // Storage cleanup is best-effort and must never fail a completed delete.
    await purgeBillObject(existing.billPath).catch(() => {});

    revalidatePath("/app");
    revalidatePath("/app/admin");
    return ok();
  }, "deleteVisit");
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
