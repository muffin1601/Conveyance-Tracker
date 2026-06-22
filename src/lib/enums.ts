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
