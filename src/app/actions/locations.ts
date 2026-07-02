"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { reverseGeocode, isValidCoord } from "@/lib/geocode";
import { haversineMeters } from "@/lib/geo";
import { isSettingsUnlocked } from "./settings";

/**
 * Reverse-geocode the browser's current GPS fix into a structured address.
 * Purely a lookup — nothing is persisted here; the client shows the detected
 * address and only then decides whether to save it (saveCustomLocation).
 */
export async function geocodeCoords(lat: number, lng: number) {
  return reverseGeocode(lat, lng);
}

/** Personal + global locations available to an employee for the dropdown. */
export async function listMyLocations(employeeId: string) {
  if (!employeeId) return [];
  return prisma.userCustomLocation.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ employeeId }, { isGlobal: true }],
    },
    orderBy: [{ isGlobal: "desc" }, { locationName: "asc" }],
    select: {
      id: true,
      locationName: true,
      address: true,
      latitude: true,
      longitude: true,
      city: true,
      state: true,
      isGlobal: true,
      source: true,
    },
  });
}

const saveSchema = z.object({
  employeeId: z.string().min(1),
  locationName: z.string().trim().min(2, "Enter a location name.").max(120),
  address: z.string().trim().max(400).optional().or(z.literal("")),
  landmark: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  country: z.string().trim().max(120).optional().or(z.literal("")),
  postalCode: z.string().trim().max(20).optional().or(z.literal("")),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  source: z.enum(["GPS", "MANUAL"]).default("MANUAL"),
});

/** Save a reusable personal location (from GPS or a manual entry). */
export async function saveCustomLocation(input: z.infer<typeof saveSchema>) {
  const data = saveSchema.parse(input);

  const hasCoords = data.latitude != null && data.longitude != null;
  if (hasCoords && !isValidCoord(data.latitude!, data.longitude!)) {
    throw new Error("Invalid coordinates.");
  }

  // Duplicate guard: same name (case-insensitive) OR within ~50 m of an
  // existing personal location.
  const existing = await prisma.userCustomLocation.findMany({
    where: { employeeId: data.employeeId, status: "ACTIVE" },
    select: { id: true, locationName: true, latitude: true, longitude: true },
  });
  const nameClash = existing.some(
    (l) => l.locationName.trim().toLowerCase() === data.locationName.toLowerCase(),
  );
  if (nameClash) throw new Error("You already saved a location with this name.");
  if (hasCoords) {
    const near = existing.some(
      (l) =>
        l.latitude != null &&
        l.longitude != null &&
        haversineMeters(
          { lat: data.latitude!, lng: data.longitude! },
          { lat: l.latitude, lng: l.longitude },
        ) < 50,
    );
    if (near) throw new Error("You already saved a location at this spot.");
  }

  const loc = await prisma.userCustomLocation.create({
    data: {
      employeeId: data.employeeId,
      locationName: data.locationName,
      address: data.address || null,
      landmark: data.landmark || null,
      city: data.city || null,
      state: data.state || null,
      country: data.country || null,
      postalCode: data.postalCode || null,
      latitude: hasCoords ? data.latitude : null,
      longitude: hasCoords ? data.longitude : null,
      source: data.source,
    },
  });
  revalidatePath("/app");
  return loc;
}

/** Remove one of the employee's own custom locations. */
export async function deleteCustomLocation(id: string, employeeId: string) {
  const loc = await prisma.userCustomLocation.findUnique({ where: { id } });
  if (!loc || loc.employeeId !== employeeId) throw new Error("Location not found.");
  await prisma.userCustomLocation.update({
    where: { id },
    data: { status: "INACTIVE" },
  });
  revalidatePath("/app");
  return { ok: true };
}

// ── Admin: promote a frequently-used personal location to a global one ──

export async function listCustomLocationsForAdmin() {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  return prisma.userCustomLocation.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ isGlobal: "asc" }, { createdAt: "desc" }],
    include: { employee: { select: { name: true } } },
    take: 300,
  });
}

export async function approveGlobalLocation(id: string, approve: boolean) {
  if (!(await isSettingsUnlocked())) throw new Error("Admin is locked.");
  await prisma.userCustomLocation.update({
    where: { id },
    data: { isGlobal: approve, approvedAt: approve ? new Date() : null },
  });
  revalidatePath("/app");
  revalidatePath("/app/admin");
  return { ok: true };
}
