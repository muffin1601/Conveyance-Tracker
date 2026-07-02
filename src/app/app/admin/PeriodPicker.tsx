"use client";

import { useRouter } from "next/navigation";

/**
 * Month selector for the admin view. Pushes the chosen YYYY-MM to the URL as
 * ?period=, which the server component reads to scope every query and export.
 * Fixes the previous behaviour where admin was hard-locked to the current
 * calendar month and showed nothing for any earlier month's entries.
 */
export function PeriodPicker({ period }: { period: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Month</span>
      <input
        type="month"
        className="input h-9 py-0 w-auto"
        value={period}
        onChange={(e) => {
          const v = e.target.value;
          if (v) router.push(`/app/admin?period=${v}`);
        }}
      />
    </label>
  );
}
