/**
 * Turn anything thrown by a server action into a message worth showing a user.
 *
 * Server actions surface failures to the client in three shapes:
 *  - `Error` with a message we wrote deliberately ("You are already at …") —
 *    show it as-is.
 *  - `Error` with a framework/infrastructure message (Prisma connection
 *    strings, "fetch failed", a digest-only production error) — these leak
 *    internals and mean nothing to an employee, so map them to plain English.
 *  - A rejected request (offline, aborted, timed out).
 *
 * Shared by every client component so error copy stays consistent.
 */

const NETWORK_HINTS = [
  "failed to fetch",
  "networkerror",
  "load failed",
  "fetch failed",
  "network request failed",
  "err_internet_disconnected",
];

const TIMEOUT_HINTS = ["timeout", "timederror", "aborted", "the operation was aborted"];

/** Infrastructure noise that must never reach a user verbatim. */
const INTERNAL_HINTS = [
  "prisma",
  "econnrefused",
  "etimedout",
  "enotfound",
  "connection pool",
  "database",
  "postgres",
  "server components render",
  "digest",
  "invalid `prisma",
  "unique constraint",
  "foreign key",
];

const GENERIC =
  "Something went wrong. Please try again — if it keeps happening, contact your administrator.";

export function errorMessage(error: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You appear to be offline. Reconnect and try again — nothing was saved.";
  }

  const raw =
    error instanceof Error ? error.message
    : typeof error === "string" ? error
    : "";
  const text = raw.trim();
  if (!text) return GENERIC;

  const lower = text.toLowerCase();
  if (NETWORK_HINTS.some((h) => lower.includes(h))) {
    return "Could not reach the server. Check your connection and try again — nothing was saved.";
  }
  if (TIMEOUT_HINTS.some((h) => lower.includes(h))) {
    return "That took too long to respond. Please try again.";
  }
  if (lower === "unauthorized") return "Your session has expired. Refresh the page and select your name again.";
  if (lower === "forbidden") return "You do not have permission to do that.";
  if (INTERNAL_HINTS.some((h) => lower.includes(h))) return GENERIC;

  // Anything left is one of our own validation/business messages. Guard against
  // an unbounded stack or payload ending up in the UI.
  return text.length > 300 ? GENERIC : text;
}
