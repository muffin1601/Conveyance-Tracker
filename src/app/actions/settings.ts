"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSettings, saveSettings } from "@/lib/settings";

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
