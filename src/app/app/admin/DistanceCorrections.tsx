"use client";

import { useState, useTransition } from "react";
import { getCorrectionScreenshot, reviewDistanceCorrection } from "@/app/actions/distanceCorrections";

type Row = { id: string; employee: string; date: string; from: string; to: string; original: number; submitted: number; status: string };

export function DistanceCorrections({ rows }: { rows: Row[] }) {
  const [busy, start] = useTransition();
  const [message, setMessage] = useState("");
  if (!rows.length) return null;
  const view = (id: string) => start(async () => { try { window.open(await getCorrectionScreenshot(id), "_blank", "noopener,noreferrer"); } catch { setMessage("Could not open screenshot. Please try again."); } });
  const review = (row: Row, decision: "APPROVED" | "REJECTED") => start(async () => { try { await reviewDistanceCorrection({ id: row.id, decision, finalDistanceKm: decision === "APPROVED" ? row.submitted : undefined }); setMessage("Correction updated."); } catch { setMessage("Could not update correction. Please try again."); } });
  return <section className="rounded-lg border p-3"><h3 className="font-semibold">Distance Corrections</h3>{message && <p className="mt-2 text-sm" role="status">{message}</p>}<div className="mt-3 space-y-3">{rows.map(row => <div key={row.id} className="rounded border p-3 text-sm"><b>{row.employee}</b><p className="text-muted">{row.date} · {row.from} → {row.to}</p><p>Recorded: {row.original.toFixed(2)} km · Submitted: {row.submitted.toFixed(2)} km</p><div className="mt-3 flex flex-wrap gap-2"><button className="btn-ghost" disabled={busy} onClick={() => view(row.id)}>View screenshot</button><button className="btn-primary" disabled={busy} onClick={() => review(row, "APPROVED")}>Approve submitted distance</button><button className="btn-ghost" disabled={busy} onClick={() => review(row, "REJECTED")}>Reject</button></div></div>)}</div></section>;
}
