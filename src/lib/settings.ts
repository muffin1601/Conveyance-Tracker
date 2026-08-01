import { prisma } from "./prisma";
import { memo, invalidate } from "./cache";
import type { VehicleType } from "./enums";

export interface ConveyanceRates {
  // ₹ per km for distance-based modes; "actual" modes are flagged with rate 0.
  BIKE: number;
  CAR: number;
  CAB: number; // actual (0 => reimburse logged actual)
  AUTO: number; // actual
  METRO: number; // fixed flat per trip
  BUS: number; // fixed flat per trip
  metroFlat: number;
  busFlat: number;
  busMetroPerKm: number; // ₹ per km used by the simple Bus/Metro mode
}

export const DEFAULT_RATES: ConveyanceRates = {
  BIKE: 4,
  CAR: 11,
  CAB: 0,
  AUTO: 0,
  METRO: 0,
  BUS: 0,
  metroFlat: 60,
  busFlat: 30,
  busMetroPerKm: 3,
};

export interface CompanySettings {
  companyName: string;
  officeAddress: string;
  rates: ConveyanceRates;
  geofenceRadius: number;
  forgotPunchoutHours: number;
  settingsPin: string; // PIN that unlocks the Settings tab
}

export const DEFAULT_SETTINGS: CompanySettings = {
  companyName: "Watcon International",
  officeAddress: "S-36, Okhla Phase II, Pocket S, Okhla Phase II, Okhla Industrial Estate, New Delhi, Delhi 110020",
  rates: DEFAULT_RATES,
  geofenceRadius: 200,
  forgotPunchoutHours: 10,
  settingsPin: "1234",
};

const SETTINGS_KEY = "settings:company";
const SETTINGS_TTL_MS = 60_000;

async function loadSettings(): Promise<CompanySettings> {
  const row = await prisma.setting.findUnique({ where: { key: "company" } });
  if (!row) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(row.value) as Partial<CompanySettings>;
    // Deep-merge `rates` so any rate key missing from older saved settings
    // (e.g. busMetroPerKm) falls back to its default instead of becoming undefined.
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      rates: { ...DEFAULT_RATES, ...(saved.rates ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Company settings, memoised for 60 s per server instance. Settings change a
 * handful of times a year but were being re-read (~450 ms) on every preview,
 * every logged visit and every page render.
 */
export async function getSettings(): Promise<CompanySettings> {
  return memo(SETTINGS_KEY, SETTINGS_TTL_MS, loadSettings);
}

export async function saveSettings(s: CompanySettings): Promise<void> {
  await prisma.setting.upsert({
    where: { key: "company" },
    create: { key: "company", value: JSON.stringify(s) },
    update: { value: JSON.stringify(s) },
  });
  invalidate(SETTINGS_KEY); // never serve a stale rate after an admin edit
}

export function ratePerKm(rates: ConveyanceRates, vt: VehicleType): number {
  return rates[vt] ?? 0;
}
