"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = { id: string; label: string; count?: number };

/** URL-backed workspace navigation that keeps a selected section on refresh and Back/Forward. */
export function WorkspaceTabs({ tabs, value, param = "tab" }: { tabs: WorkspaceTab[]; value: string; param?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState("");
  function select(id: string) {
    if (id === value || pending) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, id);
    next.delete("page");
    setTarget(id);
    start(() => router.push(`?${next.toString()}`));
  }
  return (
    <nav className="overflow-x-auto border-b" aria-label="Page sections">
      <div role="tablist" className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.id === value;
          return <button key={tab.id} type="button" role="tab" aria-selected={active}
            onClick={() => select(tab.id)}
            disabled={pending}
            className={cn("inline-flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors disabled:opacity-70", active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg")}>
            {tab.label}{typeof tab.count === "number" && tab.count > 0 ? <span className="ml-1.5 rounded bg-bg px-1.5 py-0.5 text-xs">{tab.count}</span> : null}
            {pending && target === tab.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </button>;
        })}
      </div>
    </nav>
  );
}
