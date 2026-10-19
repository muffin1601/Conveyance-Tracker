"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type WorkspaceTab = { id: string; label: string; count?: number };

/** URL-backed workspace navigation that keeps a selected section on refresh and Back/Forward. */
export function WorkspaceTabs({ tabs, value, param = "tab" }: { tabs: WorkspaceTab[]; value: string; param?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  function select(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, id);
    next.delete("page");
    router.push(`?${next.toString()}`);
  }
  return (
    <nav className="overflow-x-auto border-b" aria-label="Page sections">
      <div role="tablist" className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.id === value;
          return <button key={tab.id} type="button" role="tab" aria-selected={active}
            onClick={() => select(tab.id)}
            className={cn("border-b-2 px-3 py-3 text-sm font-medium transition-colors", active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg")}>
            {tab.label}{typeof tab.count === "number" && tab.count > 0 ? <span className="ml-1.5 rounded bg-bg px-1.5 py-0.5 text-xs">{tab.count}</span> : null}
          </button>;
        })}
      </div>
    </nav>
  );
}
