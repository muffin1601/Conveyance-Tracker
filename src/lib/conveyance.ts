import type { ConveyanceRates } from "./settings";
import type { VehicleType } from "./enums";

/**
 * Conveyance Calculation Engine.
 * Given a leg distance, the employee's vehicle and company rates, returns the
 * reimbursable amount. Distance-based modes (bike/car) multiply km by rate;
 * metro/bus are flat per trip; cab/auto are "actual" (employee-entered actual
 * fare is reimbursed elsewhere — here we return 0 for the auto-computed amount).
 */
export function computeLegAmount(
  distanceKm: number,
  vehicleType: VehicleType,
  rates: ConveyanceRates,
): number {
  switch (vehicleType) {
    case "BIKE":
      return round2(distanceKm * rates.BIKE);
    case "CAR":
      return round2(distanceKm * rates.CAR);
    case "METRO":
      return distanceKm > 0 ? rates.metroFlat : 0;
    case "BUS":
      return distanceKm > 0 ? rates.busFlat : 0;
    case "CAB":
    case "AUTO":
      // Actual fare — reimbursed on submitted receipt, not auto-derived.
      return 0;
    default:
      return 0;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
