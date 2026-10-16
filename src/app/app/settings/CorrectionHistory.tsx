"use client";

import { useState, useTransition } from "react";
import { getCorrectionScreenshot } from "@/app/actions/distanceCorrections";

export type CorrectionHistoryRow = {
  id: string;
  employee: string;
  date: string;
  from: string;
  to: string;
  original: number;
  submitted: number;
  final: number | null;
  status: "APPROVED" | "REJECTED";
  reviewedAt: string | null;
  adminNote: string | null;
  screenshotName: string;
};

export function CorrectionHistory({ rows }: { rows: CorrectionHistoryRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [, startTransition] = useTransition();

  const viewScreenshot = (id: string) => {
    const screenshotWindow = window.open("about:blank", "_blank");
    if (screenshotWindow) screenshotWindow.opener = null;
    setBusyId(id);
    setMessage("");
    startTransition(async () => {
      try {
        const url = await getCorrectionScreenshot(id);
        if (screenshotWindow) screenshotWindow.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        screenshotWindow?.close();
        setMessage("Could not open the uploaded screenshot. Please try again.");
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <section className="rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Correction history</h3>
        <p className="mt-1 text-sm text-muted">
          Previously approved and rejected distance corrections, including their uploaded evidence.
        </p>
      </div>

      {message && <p className="mt-3 text-sm" role="status">{message}</p>}

      {!rows.length ? (
        <p className="mt-4 text-sm text-muted">No reviewed distance corrections yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{row.employee}</p>
                  <p className="text-muted">{row.date} · {row.from} → {row.to}</p>
                </div>
                <span className={row.status === "APPROVED"
                  ? "badge border-teal-500/20 bg-teal-500/10 text-teal-600"
                  : "badge border-red-500/20 bg-red-500/10 text-red-600"}>
                  {row.status === "APPROVED" ? "Approved" : "Rejected"}
                </span>
              </div>

              <p className="mt-2">
                Recorded: {row.original.toFixed(2)} km · Submitted: {row.submitted.toFixed(2)} km
                {row.status === "APPROVED" && row.final != null ? ` · Approved: ${row.final.toFixed(2)} km` : ""}
              </p>
              {row.reviewedAt && (
                <p className="mt-1 text-muted">
                  Reviewed {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.reviewedAt))}
                </p>
              )}
              {row.adminNote && <p className="mt-1">Note: {row.adminNote}</p>}

              <button
                type="button"
                className="btn-ghost mt-3"
                disabled={busyId === row.id}
                onClick={() => viewScreenshot(row.id)}
              >
                {busyId === row.id ? "Opening…" : `View uploaded screenshot (${row.screenshotName})`}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
