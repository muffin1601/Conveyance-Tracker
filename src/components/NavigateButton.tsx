"use client";

import { Navigation2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One-tap "take me there". Opens Google Maps with directions/search — the
 * same URL scheme works on Android, iPhone and desktop: browsers on both
 * mobile platforms hand `google.com/maps` links straight to the installed
 * Maps app if one exists, and fall back to the web app otherwise. No native
 * deep-link scheme (`comgooglemaps://`, `geo:`) is needed for that reason,
 * and avoiding one means this never dead-ends on a device without the app.
 */

export function mapsUrl(opts: { lat?: number | null; lng?: number | null; address?: string | null }): string | null {
  if (opts.lat != null && opts.lng != null) {
    return `https://www.google.com/maps?q=${opts.lat},${opts.lng}`;
  }
  if (opts.address && opts.address.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.address.trim())}`;
  }
  return null;
}

export function NavigateButton({
  lat, lng, address, label = "Navigate", compact = false, className,
}: {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  label?: string;
  /** Icon-only, for tight rows (table cells, list items). */
  compact?: boolean;
  className?: string;
}) {
  const href = mapsUrl({ lat, lng, address });
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={compact ? `${label} — opens in Google Maps` : undefined}
      title="Opens in Google Maps"
      className={cn(
        compact
          ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-brand hover:bg-brand/10"
          : "btn-ghost shrink-0 text-sm",
        className,
      )}
    >
      <Navigation2 className="h-4 w-4" />
      {!compact && label}
    </a>
  );
}
