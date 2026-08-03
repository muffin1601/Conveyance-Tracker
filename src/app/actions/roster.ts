"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSettingsUnlocked } from "./settings";
import { attempt, ok, fail, type ActionResult } from "@/lib/result";
import { forwardGeocode, isValidCoord } from "@/lib/geocode";
import { MASTER_DATA_TAG } from "@/lib/masterData";
import { VEHICLE_TYPES } from "@/lib/enums";

/**
 * Staff and site management for the Settings tab.
 *
 * Every action is behind the same PIN as the rest of Settings, and every
 * mutation flushes the master-data cache so a new name or site shows up in the
 * pickers immediately rather than after the 5-minute revalidate window.
 *
 * Failures are RETURNED, not thrown — Next redacts thrown server-action errors
 * in production, which would leave the admin staring at a form that silently
 * refuses to submit.
 */

/** Refresh everything that reads the roster or the site list. */
function flushMasterData() {
  // updateTag (Next 16) gives read-your-own-writes inside a server action, so
  // the admin sees the new row on the very next render rather than after the
  // 5-minute revalidate window on the cached roster/site lists.
  updateTag(MASTER_DATA_TAG);
  revalidatePath("/app");
  revalidatePath("/app/settings");
  revalidatePath("/app/admin");
}

async function requireUnlocked(): Promise<string | null> {
  return (await isSettingsUnlocked()) ? null : "Settings are locked. Enter the PIN again and retry.";
}

/** Allocate the next free WAT-#### / SITE-###, tolerating gaps from deletions. */
function nextCode(used: Set<string>, prefix: string, width: number): string {
  let n = 1;
  while (used.has(`${prefix}-${String(n).padStart(width, "0")}`)) n++;
  return `${prefix}-${String(n).padStart(width, "0")}`;
}

// ──────────────────────────────────────────────────────────────
// Staff
// ──────────────────────────────────────────────────────────────

const employeeSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name.").max(120),
  designation: z.string().trim().min(2, "Enter a designation.").max(80),
  department: z.string().trim().min(2, "Enter a department.").max(80),
  vehicleType: z.enum(VEHICLE_TYPES),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
});

export type NewEmployee = z.infer<typeof employeeSchema>;

export async function createEmployee(input: NewEmployee): Promise<ActionResult<{ employeeCode: string }>> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);

    const parsed = employeeSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const data = parsed.data;

    // One read serves both the duplicate check and code allocation. The
    // comparison is done here rather than with Prisma's `mode: "insensitive"`,
    // which is Postgres-only — keeping this portable means the same code runs
    // against the SQLite database used for testing and demos.
    const roster = await prisma.employee.findMany({
      where: { deletedAt: null },
      select: { employeeCode: true, name: true, status: true },
    });
    const clash = roster.find((e) => e.name.trim().toLowerCase() === data.name.toLowerCase());
    if (clash) {
      return fail(
        `${clash.name} is already on the roster as ${clash.employeeCode}` +
        `${clash.status === "ACTIVE" ? "." : " (inactive — reactivate them instead)."}`,
      );
    }

    const employeeCode = nextCode(new Set(roster.map((e) => e.employeeCode)), "WAT", 4);

    await prisma.employee.create({
      data: {
        employeeCode,
        name: data.name,
        designation: data.designation,
        department: data.department,
        vehicleType: data.vehicleType,
        phone: data.phone || null,
        status: "ACTIVE",
      },
    });

    flushMasterData();
    return ok({ employeeCode });
  }, "createEmployee");
}

/** Deactivate or reactivate someone. Never deletes — history must stay intact. */
export async function setEmployeeStatus(id: string, active: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);

    const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!emp) return fail("That employee no longer exists.");

    await prisma.employee.update({ where: { id }, data: { status: active ? "ACTIVE" : "INACTIVE" } });
    flushMasterData();
    return ok();
  }, "setEmployeeStatus");
}

/**
 * Set (or clear) where an employee's day starts. Most staff should stay on
 * the default — the head office — so `siteId: null` clears any override.
 * A non-null id must point at a site that is actually eligible to be a
 * starting point (the head office, or one flagged `isStartingPoint`),
 * otherwise a typo'd id could silently anchor someone's whole day nowhere.
 */
export async function setEmployeeOrigin(employeeId: string, siteId: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);

    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!emp) return fail("That employee no longer exists.");

    if (siteId) {
      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { status: true, isOffice: true, isStartingPoint: true, deletedAt: true },
      });
      if (!site || site.deletedAt || site.status !== "ACTIVE") return fail("That location no longer exists.");
      if (!site.isOffice && !site.isStartingPoint) {
        return fail("That location is not enabled as a starting point.");
      }
    }

    await prisma.employee.update({ where: { id: employeeId }, data: { defaultOriginSiteId: siteId } });
    flushMasterData();
    return ok();
  }, "setEmployeeOrigin");
}

// ──────────────────────────────────────────────────────────────
// Locations (Sites)
// ──────────────────────────────────────────────────────────────

/** Look up candidate coordinates for a typed address. */
export async function lookupAddress(query: string): Promise<ActionResult<{
  address: string; city: string | null; state: string | null;
  postalCode: string | null; latitude: number; longitude: number;
}[]>> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);
    try {
      const rows = await forwardGeocode(query);
      if (!rows.length) return fail("No match for that address. Try a nearby landmark, or enter coordinates manually.");
      return ok(rows.map((r) => ({
        address: r.address, city: r.city, state: r.state,
        postalCode: r.postalCode, latitude: r.latitude, longitude: r.longitude,
      })));
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Address lookup failed.");
    }
  }, "lookupAddress");
}

const siteSchema = z.object({
  name: z.string().trim().min(2, "Enter a location name.").max(160),
  address: z.string().trim().min(4, "Enter the address.").max(400),
  landmark: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  pincode: z.string().trim().max(12).optional().or(z.literal("")),
  latitude: z.number({ message: "Look up the address or enter a latitude." }),
  longitude: z.number({ message: "Look up the address or enter a longitude." }),
  geofenceRadius: z.number().int().min(50).max(5000).default(200),
});

export type NewSite = z.infer<typeof siteSchema>;

export async function createSite(input: NewSite): Promise<ActionResult<{ code: string }>> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);

    const parsed = siteSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const data = parsed.data;

    if (!isValidCoord(data.latitude, data.longitude)) {
      return fail("Those coordinates are not valid. Look the address up again.");
    }

    // As with staff: one read, portable case-insensitive comparison.
    const existing = await prisma.site.findMany({
      where: { deletedAt: null },
      select: { code: true, name: true, status: true },
    });
    const clash = existing.find((e) => e.name.trim().toLowerCase() === data.name.toLowerCase());
    if (clash) {
      return fail(
        `A location called "${clash.name}" already exists as ${clash.code}` +
        `${clash.status === "ACTIVE" ? "." : " (inactive — reactivate it instead)."}`,
      );
    }

    const code = nextCode(new Set(existing.map((e) => e.code)), "SITE", 3);

    await prisma.site.create({
      data: {
        code,
        name: data.name,
        address: data.address,
        landmark: data.landmark || null,
        city: data.city || null,
        state: data.state || null,
        pincode: data.pincode || null,
        region: data.state === "Delhi" || data.state === "Haryana" ? "Delhi NCR" : data.state || null,
        zone: data.city || null,
        latitude: data.latitude,
        longitude: data.longitude,
        geofenceRadius: data.geofenceRadius,
        isOffice: false,
        status: "ACTIVE",
      },
    });

    flushMasterData();
    return ok({ code });
  }, "createSite");
}

/**
 * Correct an existing location's address/coordinates/landmark in place.
 *
 * Without this, fixing an approximate geocode (e.g. a farm colony with no
 * street-level map data) meant deactivating the site and recreating it under
 * a new code — which orphans every past trip's display from the "current"
 * record and is needlessly destructive for what is really just a correction.
 */
export async function updateSite(id: string, input: NewSite): Promise<ActionResult> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);

    const parsed = siteSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const data = parsed.data;

    if (!isValidCoord(data.latitude, data.longitude)) {
      return fail("Those coordinates are not valid. Look the address up again.");
    }

    const existing = await prisma.site.findMany({
      where: { deletedAt: null, id: { not: id } },
      select: { code: true, name: true, status: true },
    });
    const clash = existing.find((e) => e.name.trim().toLowerCase() === data.name.toLowerCase());
    if (clash) {
      return fail(`A different location is already named "${clash.name}" (${clash.code}).`);
    }

    const site = await prisma.site.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!site || site.deletedAt) return fail("That location no longer exists.");

    await prisma.site.update({
      where: { id },
      data: {
        name: data.name,
        address: data.address,
        landmark: data.landmark || null,
        city: data.city || null,
        state: data.state || null,
        pincode: data.pincode || null,
        region: data.state === "Delhi" || data.state === "Haryana" ? "Delhi NCR" : data.state || null,
        zone: data.city || null,
        latitude: data.latitude,
        longitude: data.longitude,
        geofenceRadius: data.geofenceRadius,
      },
    });

    flushMasterData();
    return ok();
  }, "updateSite");
}

/** Deactivate or reactivate a site. Never deletes — past trips reference it. */
export async function setSiteStatus(id: string, active: boolean): Promise<ActionResult> {
  return attempt(async () => {
    const locked = await requireUnlocked();
    if (locked) return fail(locked);

    const site = await prisma.site.findUnique({ where: { id }, select: { id: true, isOffice: true } });
    if (!site) return fail("That location no longer exists.");
    if (site.isOffice) return fail("The head office cannot be deactivated — every first trip starts there.");

    await prisma.site.update({ where: { id }, data: { status: active ? "ACTIVE" : "INACTIVE" } });
    flushMasterData();
    return ok();
  }, "setSiteStatus");
}
