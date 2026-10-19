"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Loader2, MapPinned, X } from "lucide-react";
import { getCorrectionScreenshot, reviewDistanceCorrection } from "@/app/actions/distanceCorrections";
import { Card, SectionTitle } from "@/components/ui";
import { errorMessage } from "@/lib/errors";

type Row = { id: string; employee: string; date: string; from: string; to: string; original: number; submitted: number; status: string };

export function DistanceCorrections({ rows }: { rows: Row[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  if (!rows.length) return null;

  function view(id: string) {
    setMessage(""); setBusyId(id);
    start(async () => {
      try { window.open(await getCorrectionScreenshot(id), "_blank", "noopener,noreferrer"); }
      catch (e) { setMessage(errorMessage(e)); }
      finally { setBusyId(null); }
    });
  }

  function review(row: Row, decision: "APPROVED" | "REJECTED") {
    if (pending) return;
    if (decision === "REJECTED" && !confirm(`Reject ${row.employee}'s distance correction?`)) return;
    setMessage(""); setBusyId(row.id);
    start(async () => {
      try {
        await reviewDistanceCorrection({ id: row.id, decision, finalDistanceKm: decision === "APPROVED" ? row.submitted : undefined });
        setMessage(`Correction ${decision.toLowerCase()}.`);
      } catch (e) { setMessage(errorMessage(e)); }
      finally { setBusyId(null); }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <SectionTitle>Distance corrections</SectionTitle>
          <p className="-mt-2 text-xs text-muted">Review route evidence before accepting the submitted distance.</p>
        </div>
        <span className="badge border-amber-500/20 bg-amber-500/10 text-amber-700">{rows.length} awaiting review</span>
      </div>
      {message && <p className="mb-3 rounded-md border bg-bg p-2.5 text-sm" role="status">{message}</p>}
      <div className="space-y-2">
        {rows.map((row) => {
          const busy = busyId === row.id;
          return (
            <article key={row.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{row.employee} <span className="font-normal text-muted">· {row.date}</span></p>
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-muted"><MapPinned className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {row.from} → {row.to}</p>
                </div>
                <div className="flex gap-2 text-right text-sm tabular-nums">
                  <div><span className="block text-[11px] uppercase text-muted">Recorded</span>{row.original.toFixed(2)} km</div>
                  <div className="rounded bg-brand/10 px-2 py-0.5 text-brand"><span className="block text-[11px] uppercase">Requested</span>{row.submitted.toFixed(2)} km</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost text-sm" disabled={pending} onClick={() => view(row.id)}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Evidence
                </button>
                <button className="btn-primary text-sm" disabled={pending} onClick={() => review(row, "APPROVED")}>
                  <Check className="h-4 w-4" /> Approve {row.submitted.toFixed(2)} km
                </button>
                <button className="btn-ghost text-sm" disabled={pending} onClick={() => review(row, "REJECTED")}>
                  <X className="h-4 w-4" /> Reject
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
