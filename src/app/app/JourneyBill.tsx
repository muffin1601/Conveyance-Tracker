"use client";

import { useState, useTransition } from "react";
import { Paperclip, Loader2, X } from "lucide-react";
import { attachJourneyBill, removeJourneyBill } from "@/app/actions/visit";
import { BillUpload, type BillMetaValue } from "@/components/BillUpload";
import { BillActions } from "@/components/BillActions";

/**
 * Compact per-leg bill control shown in the daily summary. The employee whose
 * timeline this is can attach / replace / remove a bill for a conveyance leg.
 */
export function JourneyBill({
  journeyId,
  employeeId,
  billPath,
  billName,
  billType,
  uploadsEnabled,
}: {
  journeyId: string;
  employeeId: string;
  billPath: string | null;
  billName: string | null;
  billType: string | null;
  uploadsEnabled: boolean;
}) {
  const [current, setCurrent] = useState<{ path: string; name: string | null; type: string | null } | null>(
    billPath ? { path: billPath, name: billName, type: billType } : null,
  );
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  if (!uploadsEnabled) return null;

  function onUploaded(meta: BillMetaValue | null) {
    if (!meta) return;
    setErr("");
    start(async () => {
      try {
        await attachJourneyBill({ journeyId, employeeId, bill: meta });
        setCurrent({ path: meta.path, name: meta.name, type: meta.type });
        setOpen(false);
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  function remove() {
    start(async () => {
      try {
        await removeJourneyBill(journeyId, employeeId);
        setCurrent(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  if (current) {
    return (
      <span className="inline-flex items-center gap-2">
        <Paperclip className="h-3 w-3 text-green-600 shrink-0" />
        <BillActions entity="conveyance" id={journeyId} name={current.name} type={current.type} compact />
        <button type="button" onClick={remove} disabled={pending} className="text-muted hover:text-red-600" title="Remove bill"><X className="h-3 w-3" /></button>
      </span>
    );
  }

  if (open) {
    return (
      <span className="inline-flex items-center gap-2">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BillUpload employeeId={employeeId} onChange={onUploaded} />}
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted">cancel</button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted hover:text-brand inline-flex items-center gap-0.5">
      <Paperclip className="h-3 w-3" /> Add bill
    </button>
  );
}
