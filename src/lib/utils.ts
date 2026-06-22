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

export function todayKey(d = new Date()): string {
  // Local YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
