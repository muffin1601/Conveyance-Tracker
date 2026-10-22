"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export function TablePagination({ total, page, size, param = "page" }: { total: number; page: number; size: number; param?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  function change(nextPage: number, nextSize = size) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, String(nextPage)); next.set("size", String(nextSize));
    start(() => router.push(`?${next.toString()}`));
  }
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
    <span className="text-muted">Showing {from}–{to} of {total}</span>
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted">Rows <select disabled={pending} className="input ml-1 inline h-8 w-auto py-0 text-xs" value={size} onChange={(e) => change(1, Number(e.target.value))}>{[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label>
      <button className="btn-ghost h-8 px-2" disabled={pending || page <= 1} onClick={() => change(1)} aria-label="First page">1</button>
      <button className="btn-ghost h-8 px-2" disabled={pending || page <= 1} onClick={() => change(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
      <span className="flex min-w-16 items-center justify-center gap-1 text-center text-xs tabular-nums">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{page} / {pages}</span>
      <button className="btn-ghost h-8 px-2" disabled={pending || page >= pages} onClick={() => change(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      <button className="btn-ghost h-8 px-2" disabled={pending || page >= pages} onClick={() => change(pages)} aria-label="Last page">{pages}</button>
    </div>
  </div>;
}
