"use client";

import { useState, useTransition } from "react";
import { Eye, Download, FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { getBillUrl } from "@/app/actions/bills";
import { errorMessage } from "@/lib/errors";

/**
 * View / Download controls for an already-saved bill. URLs are short-lived and
 * minted on demand (the bucket is private), so nothing is exposed at rest.
 * Read-only — used by the owning employee and by admins alike.
 */
export function BillActions({
  entity,
  id,
  name,
  type,
  compact,
}: {
  entity: "misc" | "conveyance";
  id: string;
  name?: string | null;
  type?: string | null;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const isImage = (type ?? "").startsWith("image/");

  function open(forceDownload: boolean) {
    setErr("");
    start(async () => {
      try {
        let url = await getBillUrl(entity, id);
        if (forceDownload) url += `&download=${encodeURIComponent(name || "bill")}`;
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        setErr(errorMessage(e));
      }
    });
  }

  const Icon = isImage ? ImageIcon : FileText;

  return (
    <span className="inline-flex items-center gap-2">
      {!compact && <Icon className="h-3.5 w-3.5 text-muted shrink-0" />}
      <button type="button" onClick={() => open(false)} disabled={pending} className="text-brand inline-flex items-center gap-0.5 text-xs hover:underline" title="View bill">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} View
      </button>
      <button type="button" onClick={() => open(true)} disabled={pending} className="text-muted inline-flex items-center gap-0.5 text-xs hover:underline" title="Download bill">
        <Download className="h-3 w-3" /> Download
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
