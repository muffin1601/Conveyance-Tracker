"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

/**
 * Month selector for the admin view. Pushes the chosen YYYY-MM to the URL as
 * ?period=, which the server component reads to scope every query and export.
 * Fixes the previous behaviour where admin was hard-locked to the current
 * calendar month and showed nothing for any earlier month's entries.
 */
export function PeriodPicker({ period }: { period: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Month
      </span>
      <input
        type="month"
        className="input h-9 py-0 w-auto"
        value={period}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          if (v) {
            const next = new URLSearchParams(searchParams.toString());
            next.set("period", v); next.delete("page");
            start(() => router.push(`/app/admin?${next.toString()}`));
          }
        }}
      />
    </label>
  );
}
