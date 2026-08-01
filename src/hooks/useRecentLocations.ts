"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-employee "recently used locations" (Issue 1).
 *
 * Kept in localStorage rather than the database: it is a pure UI affordance,
 * needs zero latency to read, and must not add a round-trip to a page whose
 * every DB hop already costs ~450 ms. Values are opaque option keys
 * (e.g. "SITE:abc"), so the list survives a location being renamed and
 * self-heals when one is deleted (unknown keys simply never match).
 */

const MAX_RECENT = 5;
const KEY_PREFIX = "watcon.recentLocations.";

function storageKey(employeeId: string): string {
  return `${KEY_PREFIX}${employeeId}`;
}

function read(employeeId: string): string[] {
  if (!employeeId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(employeeId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return []; // private mode / quota / corrupt value — recents are best-effort
  }
}

export function useRecentLocations(employeeId: string) {
  const [recent, setRecent] = useState<string[]>([]);

  // Read after mount only — localStorage is unavailable during SSR, and
  // seeding state from it directly would cause a hydration mismatch. Reading
  // an external store on mount is precisely what effects are for; the rule
  // cannot distinguish that from derived state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRecent(read(employeeId)); }, [employeeId]);

  const remember = useCallback(
    (optionKey: string) => {
      if (!employeeId || !optionKey) return;
      setRecent((prev) => {
        const next = [optionKey, ...prev.filter((v) => v !== optionKey)].slice(0, MAX_RECENT);
        try {
          window.localStorage.setItem(storageKey(employeeId), JSON.stringify(next));
        } catch {
          // ignore — the in-memory list still works for this session
        }
        return next;
      });
    },
    [employeeId],
  );

  return { recent, remember };
}
