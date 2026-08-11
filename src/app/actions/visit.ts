"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { memo } from "@/lib/cache";
import { computeDistance, haversineMeters } from "@/lib/geo";
import { isValidCoord } from "@/lib/geocode";
import { checkGpsFix, resolveGeofenceRadius, type GpsCheck } from "@/lib/gps";
import { legFromName, legToAddress, legToName } from "@/lib/journeyEndpoint";
import { attempt, ok, fail, UserError, type ActionResult } from "@/lib/result";
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
    // The street address the device's reverse-geocode returned. Descriptive
    // only — like `name`, it labels the leg and is never an input to distance,
    // geofencing or money, all of which are computed from the coordinates the
    // server verifies itself. Optional so an older client still works.
    address: z.string().trim().max(300).optional(),
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

/**
 * The device fix that authorises a visit. Required — there is no bypass flag,
 * and no client-supplied "verified"/"withinRadius" boolean is accepted: the
 * server re-runs the entire check against master-data coordinates it looks up
 * itself, so a hand-crafted request gains nothing beyond what a real phone
 * standing at the site could send.
 */
const gpsFixSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number().positive(),
  capturedAt: z.number().int().positive(),
});

/**
 * Logging a visit additionally requires the GPS fix and an idempotency key; a
 * preview needs neither.
 */
const logSchema = schema.extend({
  gps: gpsFixSchema,
  /**
   * Device-generated id, minted before the visit was stored locally. The
   * unique constraint on Journey.clientVisitId turns any resubmission into a
   * lookup of the row the first attempt created.
   */
  clientVisitId: z.string().trim().min(8).max(64),
  /** When the visit was made on the device — may predate the sync by days. */
  visitAt: z.number().int().positive(),
});

type Input = z.infer<typeof schema>;
type LogInput = z.infer<typeof logSchema>;

// A resolved point on the map, with whichever endpoint reference applies.
interface Point {
  name: string;
  /** The endpoint's own street address, when it has one — never a different site's. */
  address: string | null;
  lat: number;
  lng: number;
  siteId: string | null;
  customLocationId: string | null;
  locationType: "MASTER" | "GPS" | "CUSTOM";
  /**
   * The location's own geofence, when it has one (master sites do). Null for
   * saved/ad-hoc points, which fall back to the company-wide radius.
   */
  geofenceRadius: number | null;
  /**
   * True for the head office and any other starting-point site (the showroom).
   * As a DESTINATION these are the places whose radius is not a hard gate —
   * see the `enforceRange` note in lib/gps.ts. Staff routinely log the return
   * leg to their base from home, hours later.
   */
  rangeExempt: boolean;
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
    // The address the previous leg recorded for this very point. Legs written
    // before `toAddress` existed have none, and null is correct there — showing
    // the OLD office/origin's address instead would be exactly the bug this
    // type exists to prevent.
    address: chained.toAddress ?? null,
    lat: lat ?? office.lat,
    lng: lng ?? office.lng,
    siteId: chained.toSiteId,
    customLocationId: chained.toCustomLocationId,
    locationType: (chained.locationType as Point["locationType"]) ?? "MASTER",
    // Only a DESTINATION's radius is ever enforced, so the origin never needs one.
    geofenceRadius: null,
    // Likewise only a DESTINATION's exemption matters.
    rangeExempt: false,
  };
  return { from, sequence };
}

function siteToPoint(site: {
  id: string; name: string; address: string; latitude: number; longitude: number;
  geofenceRadius?: number | null; isOffice?: boolean; isStartingPoint?: boolean;
}): Point {
  return {
    name: site.name,
    address: site.address,
    lat: site.latitude,
    lng: site.longitude,
    siteId: site.id,
    customLocationId: null,
    locationType: "MASTER" as const,
    geofenceRadius: site.geofenceRadius ?? null,
    rangeExempt: (site.isOffice ?? false) || (site.isStartingPoint ?? false),
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
      select: { id: true, name: true, address: true, latitude: true, longitude: true },
    });
    if (!office) throw new UserError("Office location not configured. Ask an admin to set it up.");
    return siteToPoint({ ...office, isOffice: true });
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
            id: true, name: true, address: true, latitude: true, longitude: true,
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

const NO_COORDS_MESSAGE =
  "GPS coordinates are not configured for this location. Please contact the administrator.";

/**
 * Turn a rejected GPS check into the sentence the employee reads. Never leaks
 * a browser error code or a raw coordinate.
 */
function gpsCheckMessage(check: GpsCheck, destinationName: string): string {
  switch (check.code) {
    case "NO_TARGET_COORDS":
      return NO_COORDS_MESSAGE;
    case "INVALID_FIX":
      return "Your location could not be confirmed. Please try again.";
    case "POOR_ACCURACY":
      return "Your location signal is too weak to confirm where you are. Please move outside or near a window and try again.";
    case "STALE_FIX":
      return "Your location reading has expired. Please check your location again.";
    case "OUT_OF_RANGE":
      return (
        `You are currently outside the allowed location area. ` +
        `Please move closer to ${destinationName} and try again.` +
        (check.distanceM != null
          ? ` (You are about ${formatMetres(check.distanceM)} away; you need to be within ${formatMetres(check.radiusM)}.)`
          : "")
      );
    default:
      return "Your location could not be confirmed. Please try again.";
  }
}

function formatMetres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Turn a destination input into a resolved Point. */
async function resolveDestination(
  dest: Input["destination"],
  employeeId: string,
): Promise<Point> {
  if (dest.kind === "SITE") {
    const site = await prisma.site.findUnique({
      where: { id: dest.siteId },
      select: {
        id: true, name: true, address: true, latitude: true, longitude: true,
        geofenceRadius: true, isOffice: true, isStartingPoint: true, status: true, deletedAt: true,
      },
    });
    if (!site || site.deletedAt || site.status !== "ACTIVE") throw new UserError("Site not found.");
    // A site whose coordinates were never filled in cannot be verified against,
    // and must not be waved through just because a fix was obtained.
    if (!isValidCoord(site.latitude, site.longitude)) throw new UserError(NO_COORDS_MESSAGE);
    return siteToPoint(site);
  }
  if (dest.kind === "CUSTOM") {
    const loc = await prisma.userCustomLocation.findUnique({ where: { id: dest.customLocationId } });
    if (!loc || loc.status !== "ACTIVE") throw new UserError("Location not found.");
    // Personal locations are only usable by their owner (global ones by anyone).
    if (!loc.isGlobal && loc.employeeId !== employeeId) throw new UserError("Location not found.");
    if (loc.latitude == null || loc.longitude == null || !isValidCoord(loc.latitude, loc.longitude)) {
      throw new UserError(NO_COORDS_MESSAGE);
    }
    return {
      name: loc.locationName,
      address: loc.address,
      lat: loc.latitude,
      lng: loc.longitude,
      siteId: null,
      customLocationId: loc.id,
      locationType: loc.source === "GPS" ? "GPS" : "CUSTOM",
      geofenceRadius: null, // no per-location radius — company default applies
      rangeExempt: false,
    };
  }
  // GPS — an unsaved geolocated point. The coordinates in the payload are only
  // a preview convenience; logVisit replaces them with the verified fix, so a
  // forged pair cannot become a destination.
  if (!isValidCoord(dest.lat, dest.lng)) throw new UserError("Invalid coordinates.");
  return {
    name: dest.name,
    address: dest.address ?? null,
    lat: dest.lat,
    lng: dest.lng,
    siteId: null,
    customLocationId: null,
    locationType: "GPS",
    geofenceRadius: null,
    rangeExempt: false,
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

/**
 * The one distance for a leg. Everything downstream — the amount, the admin
 * table, the exports — reads this single value, so there is no way for two
 * screens to disagree and no way for a travelled distance and a routed
 * distance to be added together.
 *
 * A hand-entered distance wins when the employee supplied one (the auto
 * calculation is unavailable for saved locations with no coordinates), and is
 * marked MANUAL so it is never mistaken for a measured road route.
 */
async function computeLeg(from: Point, to: Point, manualDistanceKm: number | undefined) {
  if (typeof manualDistanceKm === "number" && manualDistanceKm > 0) {
    return {
      distanceKm: manualDistanceKm,
      // No provider measured this, so there is no road distance to record. The
      // straight line is still computed from the real endpoints — it is what a
      // reviewer needs to judge whether a typed figure is plausible.
      roadKm: null,
      haversineKm:
        Math.round(haversineMeters({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }) / 10) / 100,
      durationMin: null as number | null,
      source: "MANUAL" as const,
      routeAvailable: false,
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

export interface VisitPreview {
  fromName: string;
  toName: string;
  km: number;
  amount: number;
  durationMin?: number | null;
  source?: string;
  tripNumber: number;
  alreadyHere: boolean;
}

/**
 * Validate the form payload into a typed input, or the message explaining what
 * is wrong with it. Zod's own `parse` throws a JSON blob of issues, which the
 * production build then redacts to nothing useful — so the first issue's
 * message (they are all written for the user) is returned instead.
 */
function parseInput(input: Input): { ok: true; value: Input } | { ok: false; error: string } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, error: first?.message || "Check the form and try again." };
}

/** Preview the next leg without persisting — powers the live estimate on the form. */
export async function previewVisit(input: Input): Promise<ActionResult<VisitPreview>> {
  return attempt(async () => {
    const parsed = parseInput(input);
    if (!parsed.ok) return fail(parsed.error);
    const { employeeId, destination, mode, fareActual, manualDistanceKm } = parsed.value;
    const workDate = todayKey();
    const { from, to, sequence, settings } = await resolveLegContext(employeeId, workDate, destination);

    if (isSamePlace(from, to)) {
      return ok({
        fromName: from.name, toName: to.name, km: 0, amount: 0,
        tripNumber: sequence + 1, alreadyHere: true,
      });
    }

    const dist = await computeLeg(from, to, manualDistanceKm);
    const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);
    return ok({
      fromName: from.name,
      toName: to.name,
      km: dist.distanceKm,
      amount,
      durationMin: dist.durationMin,
      source: dist.source,
      tripNumber: sequence + 1,
      alreadyHere: false,
    });
  }, "previewVisit");
}

export interface LoggedVisit {
  km: number;
  amount: number;
  from: string;
  site: string;
  employee: string;
  tripNumber: number;
}

/**
 * What the device's sync loop needs to know. Distinguishing a permanent
 * refusal from a temporary one is the whole difference between "retry this
 * forever" and "tell the employee something is wrong with this one visit".
 */
export type SyncOutcome =
  | { status: "SYNCED"; serverId: string; visit: LoggedVisit }
  /** Already stored — this exact visit was submitted before. Not an error. */
  | { status: "DUPLICATE"; serverId: string | null; visit: LoggedVisit | null }
  /** The server has judged it and said no. Retrying will not change that. */
  | { status: "REJECTED"; reason: string }
  /** Something on our side is unwell. Keep the visit and come back later. */
  | { status: "RETRY"; reason: string };

/** The message shown for any server-side problem the employee did not cause. */
const RETRY_MESSAGE = "Visit saved. It will sync automatically.";

/** Prisma's unique-constraint error, without importing the error classes. */
function isUniqueViolation(e: unknown, field: string): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== "P2002") return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((f) => f.includes(field));
}

function loggedVisitFrom(row: {
  distanceKm: number; amount: number; fromName: string | null; toName: string | null; sequence: number;
}, employeeName: string): LoggedVisit {
  return {
    km: row.distanceKm,
    amount: row.amount,
    from: row.fromName ?? "Starting point",
    site: row.toName ?? "Destination",
    employee: employeeName,
    tripNumber: row.sequence + 1,
  };
}

/**
 * Submit one visit. Idempotent on `clientVisitId`: the same key always
 * resolves to the same Journey row, so a retry after a lost response — the
 * classic way offline queues duplicate data — returns the original visit
 * instead of creating a second one.
 *
 * GPS verification is re-run here in full. Offline changes only WHEN a visit
 * arrives, never WHETHER it was verified.
 */
export async function syncVisit(input: LogInput): Promise<SyncOutcome> {
  try {
    return await runSyncVisit(input);
  } catch (e) {
    if (e instanceof UserError) return { status: "REJECTED", reason: e.message };
    // A database hiccup, a dropped pool connection, a provider timeout: the
    // visit is still safely on the device, so say nothing alarming and let the
    // queue try again.
    console.error("[syncVisit]", e);
    return { status: "RETRY", reason: RETRY_MESSAGE };
  }
}

async function runSyncVisit(input: LogInput): Promise<SyncOutcome> {
  const parsed = logSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const isGps = first?.path?.[0] === "gps";
    return {
      status: "REJECTED",
      reason: isGps
        ? "Your current location is required to log a visit. Please allow location access and try again."
        : first?.message || "Check the form and try again.",
    };
  }
  const { employeeId, destination, mode, fareActual, manualDistanceKm, gps, clientVisitId, visitAt } = parsed.data;

  // ── Idempotency, before anything else ───────────────────────────────
  const already = await prisma.journey.findUnique({
    where: { clientVisitId },
    select: {
      id: true, distanceKm: true, amount: true, fromName: true, toName: true, sequence: true,
      employee: { select: { name: true } },
    },
  });
  if (already) {
    return {
      status: "DUPLICATE",
      serverId: already.id,
      visit: loggedVisitFrom(already, already.employee.name),
    };
  }

  // The day a queued visit belongs to is the day it was MADE, not the day it
  // reached the server — otherwise a visit logged at 9pm with no signal would
  // land on tomorrow's sheet, and chain from the wrong starting point.
  const workDate = todayKey(new Date(visitAt));

  const [employee, ctx] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, status: true, deletedAt: true },
    }),
    resolveLegContext(employeeId, workDate, destination),
  ]);
  if (!employee || employee.deletedAt) return { status: "REJECTED", reason: "Employee not found." };
  if (employee.status !== "ACTIVE") {
    return { status: "REJECTED", reason: "This employee is no longer active." };
  }

  const { from, sequence, settings, lastLeg } = ctx;
  let { to } = ctx;

  // ── GPS verification (server authoritative) ─────────────────────────
  // Re-run in full here. The client shows the same verdict live, but that is
  // only for the employee's benefit — nothing it reports is trusted, and no
  // "gpsVerified" style flag exists in the payload to trust in the first place.
  //
  // For an ad-hoc GPS destination the destination IS wherever the employee is
  // standing, so it is taken FROM the verified fix rather than from the
  // request body; forged destination coordinates therefore have no effect.
  if (to.locationType === "GPS" && !to.siteId && !to.customLocationId) {
    to = { ...to, lat: gps.lat, lng: gps.lng };
  }
  const radiusM = resolveGeofenceRadius(to.geofenceRadius, settings.geofenceRadius);
  // `visitAt` anchors the freshness rule to when the visit was made, so a
  // visit queued offline stays valid until it can be delivered.
  // The head office and the showroom (both starting-point sites) are the
  // destinations whose radius is not a hard gate: the end-of-day return leg is
  // routinely logged from home, hours later.
  // Everything else about the fix is still enforced, and the real distance is
  // still measured and stored below.
  const gpsCheck = checkGpsFix(gps, { lat: to.lat, lng: to.lng }, radiusM, {
    visitAt,
    enforceRange: !to.rangeExempt,
  });
  if (gpsCheck.code !== "OK") {
    return { status: "REJECTED", reason: gpsCheckMessage(gpsCheck, to.name) };
  }

  if (isSamePlace(from, to)) {
    return { status: "REJECTED", reason: `You are already at ${to.name}. Pick a different destination.` };
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
    return {
      status: "REJECTED",
      reason: `This trip (${from.name} → ${to.name}) was just logged. Refresh to see it.`,
    };
  }

  const dist = await computeLeg(from, to, manualDistanceKm);
  const amount = legAmount(dist.distanceKm, mode, fareActual, settings.rates);

  // Two tabs (or a tab and a retry) can reach this line concurrently with the
  // same key — the pre-flight lookup above cannot see a row that has not been
  // committed yet. The unique index is the real arbiter; a collision here
  // means the other writer won, so the visit exists and this is a duplicate.
  const created = await prisma.journey
    .create({
      data: {
        clientVisitId,
        employeeId,
        workDate,
        fromSiteId: from.siteId,
        toSiteId: to.siteId,
        fromCustomLocationId: from.customLocationId,
        toCustomLocationId: to.customLocationId,
        fromName: from.name,
        toName: to.name,
        fromAddress: from.address,
        toAddress: to.address,
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
        // Proof of presence, exactly as the server measured it.
        gpsLat: gps.lat,
        gpsLng: gps.lng,
        gpsAccuracy: gpsCheck.accuracyM,
        gpsCapturedAt: new Date(gps.capturedAt),
        gpsDistanceM: gpsCheck.distanceM,
        gpsRadiusM: gpsCheck.radiusM,
      },
    })
    .catch((e: unknown) => {
      if (isUniqueViolation(e, "clientVisitId")) return null;
      throw e;
    });

  if (!created) {
    const winner = await prisma.journey.findUnique({
      where: { clientVisitId },
      select: {
        id: true, distanceKm: true, amount: true, fromName: true, toName: true, sequence: true,
        employee: { select: { name: true } },
      },
    });
    return {
      status: "DUPLICATE",
      serverId: winner?.id ?? null,
      visit: winner ? loggedVisitFrom(winner, winner.employee.name) : null,
    };
  }

  revalidatePath("/app");
  return {
    status: "SYNCED",
    serverId: created.id,
    visit: {
      km: created.distanceKm,
      amount: created.amount,
      from: from.name,
      site: to.name,
      employee: employee.name,
      tripNumber: created.sequence + 1,
    },
  };
}

/**
 * Log one leg directly, without going through the device queue.
 *
 * Kept as the original returned-error contract for any caller that wants a
 * simple "did it work" answer. The Check In screen no longer uses it: it
 * writes to the device queue first (never lose a verified visit) and drains
 * that queue through `syncVisit`.
 */
export async function logVisit(input: LogInput): Promise<ActionResult<LoggedVisit>> {
  const outcome = await syncVisit(input);
  if (outcome.status === "SYNCED") return ok(outcome.visit);
  if (outcome.status === "DUPLICATE" && outcome.visit) return ok(outcome.visit);
  if (outcome.status === "DUPLICATE") return fail("That visit was already logged.");
  return fail(outcome.reason);
}

// ── Journey state (Issue 3 / 4) ───────────────────────────────────────────

export interface JourneyState {
  /** 1-based number of the trip the employee is about to log. */
  tripNumber: number;
  /** Where the next trip starts. Read-only unless this is the first trip. */
  fromName: string;
  /** That location's own street address — null when the leg it came from recorded none. */
  fromAddress: string | null;
  /** Coordinates of the starting point — for the "how far is that from me" GPS check and Navigate. */
  fromLat: number | null;
  fromLng: number | null;
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
    /** The destination's street address, for the timeline tooltip. */
    toAddress: string | null;
    /** The leg's destination — for a one-tap Navigate link on the timeline. */
    toLat: number | null;
    toLng: number | null;
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
        id: true, sequence: true, fromName: true, toName: true, toAddress: true,
        distanceKm: true, amount: true, vehicleType: true, createdAt: true,
        toLat: true, toLng: true,
        fromSite: { select: { name: true, latitude: true, longitude: true } },
        toSite: { select: { name: true, latitude: true, longitude: true, address: true } },
        fromCustomLocation: { select: { locationName: true } },
        toCustomLocation: { select: { locationName: true, address: true } },
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
    fromAddress: chainedTail ? legToAddress(chainedTail) : origin.address,
    fromLat: chainedTail ? (chainedTail.toLat ?? chainedTail.toSite?.latitude ?? null) : origin.lat,
    fromLng: chainedTail ? (chainedTail.toLng ?? chainedTail.toSite?.longitude ?? null) : origin.lng,
    atOrigin: !chainedTail,
    totalKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    totalAmount: legs.reduce((s, l) => s + l.amount, 0),
    legs: legs.map((l) => ({
      id: l.id,
      sequence: l.sequence,
      fromName: legFromName(l),
      toName: legToName(l),
      toAddress: legToAddress(l),
      toLat: l.toLat ?? l.toSite?.latitude ?? null,
      toLng: l.toLng ?? l.toSite?.longitude ?? null,
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
