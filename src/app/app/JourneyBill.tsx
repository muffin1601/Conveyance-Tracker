"use client";

import { useState, useTransition } from "react";
import { Paperclip, Loader2, X } from "lucide-react";
import { attachJourneyBill, removeJourneyBill } from "@/app/actions/visit";
import { BillUpload, type BillMetaValue } from "@/components/BillUpload";
import { BillActions } from "@/components/BillActions";
import { errorMessage } from "@/lib/errors";
import { t, DEFAULT_LANG, type Lang } from "@/lib/i18n";

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
  lang = DEFAULT_LANG,
}: {
  journeyId: string;
  employeeId: string;
  billPath: string | null;
  billName: string | null;
  billType: string | null;
  uploadsEnabled: boolean;
  lang?: Lang;
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
        setErr(errorMessage(e));
      }
    });
  }

  function remove() {
    start(async () => {
      try {
        await removeJourneyBill(journeyId, employeeId);
        setCurrent(null);
      } catch (e) {
        setErr(errorMessage(e));
      }
    });
  }

  if (current) {
    return (
      <span className="inline-flex items-center gap-2">
        <Paperclip className="h-3 w-3 text-green-600 shrink-0" />
        <BillActions entity="conveyance" id={journeyId} name={current.name} type={current.type} compact lang={lang} />
        <button type="button" onClick={remove} disabled={pending} className="text-muted hover:text-red-600" title={t(lang, "removeBill")}><X className="h-3 w-3" /></button>
      </span>
    );
  }

  if (open) {
    return (
      <span className="inline-flex items-center gap-2">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BillUpload employeeId={employeeId} onChange={onUploaded} lang={lang} />}
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted">{t(lang, "cancel")}</button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted hover:text-brand inline-flex items-center gap-0.5">
      <Paperclip className="h-3 w-3" /> {t(lang, "addBill")}
    </button>
  );
}
