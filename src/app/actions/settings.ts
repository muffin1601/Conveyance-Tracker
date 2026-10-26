"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSettings, saveSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { visitAmount, type TravelMode } from "@/lib/travel";

const UNLOCK_COOKIE = "watcon_settings_ok";

/** True if the current session has entered the correct Settings PIN. */
export async function isSettingsUnlocked(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(UNLOCK_COOKIE)?.value === "1";
}

/** Validate the PIN and unlock the Settings tab for this browser session. */
export async function unlockSettings(pin: string): Promise<{ ok: boolean }> {
  const settings = await getSettings();
  if (pin.trim() !== settings.settingsPin) return { ok: false };
  const jar = await cookies();
  jar.set(UNLOCK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return { ok: true };
}

export async function lockSettings() {
  const jar = await cookies();
  jar.delete(UNLOCK_COOKIE);
}

const schema = z.object({
  companyName: z.string().min(1, "Company name is required."),
  officeAddress: z.string().min(1, "Office address is required."),
  bikePerKm: z.coerce.number().min(0, "Bike rate must be 0 or more."),
  carPerKm: z.coerce.number().min(0, "Car rate must be 0 or more."),
  busMetroPerKm: z.coerce.number().min(0, "Bus/Metro rate must be 0 or more."),
  settingsPin: z.string().min(4, "PIN must be at least 4 characters."),
});

/** Save settings — only allowed once the PIN has been entered. */
export async function saveAppSettings(input: z.infer<typeof schema>) {
  if (!(await isSettingsUnlocked())) throw new Error("Settings are locked.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
  }
  const v = parsed.data;
  const current = await getSettings();
  await saveSettings({
    ...current,
    companyName: v.companyName,
    officeAddress: v.officeAddress,
    settingsPin: v.settingsPin,
    rates: {
      ...current.rates,
      BIKE: v.bikePerKm,
      CAR: v.carPerKm,
      busMetroPerKm: v.busMetroPerKm,
    },
  });
  revalidatePath("/app");
  revalidatePath("/app/settings");
  return { ok: true };
}

const entrySchema = z.object({
  id: z.string().optional(),
  employeeId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fromName: z.string().trim().min(1).max(200),
  toName: z.string().trim().min(1).max(200),
  mode: z.enum(["BIKE", "CAR", "BUSMETRO"]),
  distanceKm: z.coerce.number().positive().max(2000),
});

/** PIN-gated manual conveyance entry for staff who could not log a trip. */
export async function saveStaffEntry(input: z.infer<typeof entrySchema>) {
  if (!(await isSettingsUnlocked())) throw new Error("Settings are locked.");
  const v = entrySchema.parse(input);
  const employee = await prisma.employee.findFirst({ where: { id: v.employeeId, deletedAt: null } });
  if (!employee) throw new Error("Select a staff member from the roster.");
  const settings = await getSettings();
  const distanceKm = Math.round(v.distanceKm * 100) / 100;
  const amount = visitAmount(distanceKm, v.mode as TravelMode, settings.rates);
  const currentSequence = await prisma.journey.count({ where: { employeeId: v.employeeId, workDate: v.workDate } });
  const data = {
    employeeId: v.employeeId,
    workDate: v.workDate,
    fromName: v.fromName,
    toName: v.toName,
    vehicleType: v.mode,
    distanceKm,
    haversineKm: distanceKm,
    amount,
    source: "MANUAL",
    manualDistance: true,
    manualReason: null,
    roadKm: null,
    durationMin: null,
    locationType: "CUSTOM",
  };
  if (v.id) {
    const existing = await prisma.journey.findUnique({ where: { id: v.id } });
    if (!existing) throw new Error("Entry not found.");
    await prisma.journey.update({ where: { id: v.id }, data });
    await audit({ action: "UPDATE", entity: "Journey", entityId: v.id, meta: { adminEntry: true, employeeId: employee.id } });
  } else {
    const created = await prisma.journey.create({
      data: { ...data, sequence: currentSequence, fromLat: null, fromLng: null, toLat: null, toLng: null },
    });
    await audit({ action: "CREATE", entity: "Journey", entityId: created.id, meta: { adminEntry: true, employeeId: employee.id } });
  }
  revalidatePath("/app/settings");
  revalidatePath("/app/admin");
  revalidatePath("/app");
  return { ok: true };
}
