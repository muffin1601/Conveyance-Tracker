import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function inr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function km(value: number): string {
  return `${value.toFixed(1)} km`;
}

// Business timezone. Production servers (e.g. Vercel) run in UTC, which would
// otherwise bucket late-evening IST activity onto the wrong calendar day. All
// day/month grouping is computed in this zone. Override via APP_TIMEZONE.
const APP_TZ = process.env.APP_TIMEZONE || "Asia/Kolkata";

export function todayKey(d = new Date()): string {
  // YYYY-MM-DD in the business timezone. en-CA gives ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function monthKey(d = new Date()): string {
  return todayKey(d).slice(0, 7);
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
