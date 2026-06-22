import type { ConveyanceRates } from "./settings";

/** Simple per-visit travel modes shown on the Check In form. */
export const TRAVEL_MODES = ["BIKE", "CAR", "BUSMETRO"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** Reimbursable amount for a single office→site trip, by selected mode. */
export function visitAmount(distanceKm: number, mode: TravelMode, rates: ConveyanceRates): number {
  const perKm = mode === "BIKE" ? rates.BIKE : mode === "CAR" ? rates.CAR : rates.busMetroPerKm;
  return Math.round(distanceKm * perKm * 100) / 100;
}
