"use client";

import { CheckCircle2, CloudOff, Loader2, RefreshCw, TriangleAlert, Wifi } from "lucide-react";
import type { QueuedVisit } from "@/lib/offlineQueue";
import { discardVisit } from "@/lib/offlineQueue";
import { cn } from "@/lib/utils";
import { t, type Lang } from "@/lib/i18n";

/**
 * The whole network story, in one quiet strip.
 *
 * Being offline is a normal working condition for a field employee, not an
 * error — so it is stated in grey, never in red, and always paired with the
 * reassurance that visits are still being kept. The only warning colour in
 * here is reserved for a visit the server actually refused, which is the one
 * case that genuinely needs a person.
 */
export function ConnectionStatus({
  lang, online, pending, rejected, syncing, justSynced, onRetry, onChanged,
}: {
  lang: Lang;
  online: boolean;
  pending: QueuedVisit[];
  rejected: QueuedVisit[];
  syncing: boolean;
  justSynced: number;
  onRetry: () => void;
  onChanged: () => void;
}) {
  const pendingLabel =
    pending.length === 1
      ? t(lang, "pendingOne")
      : t(lang, "pendingMany", { n: String(pending.length) });

  // Nothing outstanding and the connection is fine: show the smallest possible
  // acknowledgement rather than a banner nobody needs to read.
  const quiet = online && pending.length === 0 && rejected.length === 0 && !justSynced;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-sm",
          online ? "bg-bg" : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        <span className="flex items-center gap-1.5 font-medium">
          {online ? (
            <Wifi className="h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <CloudOff className="h-4 w-4 shrink-0 text-amber-600" />
          )}
          {online ? t(lang, "onlineShort") : t(lang, "offlineShort")}
        </span>

        <span className="min-w-0 flex-1 text-muted">
          {!online
            ? t(lang, "statusOffline")
            : syncing
              ? t(lang, "syncingNow")
              : pending.length > 0
                ? pendingLabel
                : justSynced > 0
                  ? t(lang, "syncedOk")
                  : t(lang, "statusOnline")}
        </span>

        {syncing && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />}
        {!syncing && justSynced > 0 && pending.length === 0 && (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        )}
        {!syncing && online && pending.length > 0 && (
          <button type="button" onClick={onRetry} className="btn-ghost h-8 shrink-0 px-2.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            {t(lang, "syncNow")}
          </button>
        )}
      </div>

      {/* Visits still queued — counted, then named, so the employee can see
          their own work is safe rather than having to trust a number. The
          count repeats here because offline the line above is given over to
          the reassurance, which is the more important thing to read first. */}
      {pending.length > 0 && !quiet && (
        <p className="px-1 text-xs font-medium text-muted">{pendingLabel}</p>
      )}
      {pending.length > 0 && !quiet && (
        <ul className="space-y-1 px-1 text-xs text-muted">
          {pending.slice(0, 4).map((v) => (
            <li key={v.clientVisitId} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span className="min-w-0 flex-1 truncate">{v.destinationName}</span>
              <span className="shrink-0 tabular-nums">
                {new Date(v.visitAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
          {pending.length > 4 && <li className="pl-3">+{pending.length - 4}</li>}
        </ul>
      )}

      {rejected.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-sm">
          <div className="flex items-center gap-1.5 font-medium text-amber-700">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {rejected.length === 1
              ? t(lang, "needsAttentionOne")
              : t(lang, "needsAttentionMany", { n: String(rejected.length) })}
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {rejected.map((v) => (
              <li key={v.clientVisitId} className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.destinationName}</span>
                  {v.lastMessage && (
                    <span className="block text-xs leading-snug text-muted">{v.lastMessage}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void discardVisit(v.clientVisitId).then(onChanged).catch(() => {})}
                  className="btn-ghost h-8 shrink-0 px-2.5 text-xs"
                >
                  {t(lang, "dismiss")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
