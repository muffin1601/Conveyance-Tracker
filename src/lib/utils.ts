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
  // Timestamps are stored in UTC; the business reads them in IST. Without the
  // explicit zone this rendered in the SERVER's zone, which on Vercel is UTC —
  // a 3pm trip printed as 09:30.
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    // en-IN renders the meridiem lowercase ("03:42 pm"); the reports read it
    // uppercase, and Node/browser ICU builds disagree on the separator too.
  }).format(new Date(d)).replace(/\s*([ap])\.?\s?m\.?$/i, (_m, p: string) => ` ${p.toUpperCase()}M`);
}

/** "17 Aug 2026" in the business timezone. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(d));
}

/** "17 Aug 2026, 03:42 PM" — for single-column and export use. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `${fmtDate(d)}, ${fmtTime(d)}`;
}

/**
 * The login time to show for a location record.
 *
 * `loginAt` is the real thing: the moment the employee identified themselves on
 * the device that logged this record. Records written before that was captured
 * have none, so we fall back to `createdAt` — when the location itself was
 * recorded, which for those rows is the same visit to the same place and is the
 * honest answer. Nothing is invented: a record with neither reports "—".
 */
export function loginTimestamp(
  r: { loginAt?: Date | string | null; createdAt?: Date | string | null },
): Date | null {
  const raw = r.loginAt ?? r.createdAt ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
