// Canonical enum value sets. Stored as strings for SQLite portability; these
// are the single source of truth used across server actions and UI.

export const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  EMPLOYEE: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

export const VEHICLE_TYPES = ["BIKE", "CAR", "CAB", "AUTO", "METRO", "BUS"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  BIKE: "Bike",
  CAR: "Car",
  CAB: "Cab",
  AUTO: "Auto",
  METRO: "Metro",
  BUS: "Bus",
};

// Miscellaneous (non-conveyance) expense categories. "OTHER" requires a
// free-text customCategory. Order here drives the dropdown order in the UI.
export const MISC_CATEGORIES = [
  "PARKING",
  "TOLL",
  "FOOD",
  "TEA",
  "REPAIR",
  "WASH",
  "FUEL",
  "HOTEL",
  "COURIER",
  "OTHER",
] as const;
export type MiscCategory = (typeof MISC_CATEGORIES)[number];

export const MISC_CATEGORY_LABEL: Record<MiscCategory, string> = {
  PARKING: "Parking",
  TOLL: "Toll Tax",
  FOOD: "Food",
  TEA: "Tea/Coffee",
  REPAIR: "Auto Repair",
  WASH: "Vehicle Washing",
  FUEL: "Fuel",
  HOTEL: "Hotel",
  COURIER: "Courier",
  OTHER: "Other",
};

// How a journey's destination was chosen — used for report filtering.
export const LOCATION_TYPES = ["MASTER", "GPS", "CUSTOM"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  MASTER: "Master Location",
  GPS: "GPS Location",
  CUSTOM: "Custom Location",
};

export const CLAIM_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "MANAGER_APPROVED",
  "ADMIN_APPROVED",
  "FINANCE_APPROVED",
  "PAID",
  "REJECTED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// The approval ladder: which stage advances which status.
export const APPROVAL_FLOW: Record<
  string,
  { stage: "MANAGER" | "ADMIN" | "FINANCE"; next: ClaimStatus }
> = {
  SUBMITTED: { stage: "MANAGER", next: "MANAGER_APPROVED" },
  MANAGER_APPROVED: { stage: "ADMIN", next: "ADMIN_APPROVED" },
  ADMIN_APPROVED: { stage: "FINANCE", next: "FINANCE_APPROVED" },
  FINANCE_APPROVED: { stage: "FINANCE", next: "PAID" },
};
