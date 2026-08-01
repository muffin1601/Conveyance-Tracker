import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("card p-4", className)}>{children}</div>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">{children}</h2>
  );
}

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold", accent && "text-brand")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-500/10 text-green-600 border-green-500/20",
  INACTIVE: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  OPEN: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  CLOSED: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  DRAFT: "bg-gray-500/10 text-gray-500 border-gray-500/20",
  SUBMITTED: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  MANAGER_APPROVED: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  ADMIN_APPROVED: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  FINANCE_APPROVED: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  PAID: "bg-green-500/10 text-green-600 border-green-500/20",
  REJECTED: "bg-red-500/10 text-red-600 border-red-500/20",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("badge", STATUS_STYLES[status] ?? "bg-bg text-muted")}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted py-8 text-center">{children}</div>;
}

/**
 * A single shimmering placeholder block. Used instead of an empty region while
 * a streamed server component resolves, so the page never shows dead space.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-fg/[0.07] dark:bg-fg/[0.09]", className)}
    />
  );
}

/** Placeholder for the "Today's Summary" card while its query streams in. */
export function SummarySkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading today's summary" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <div className="mt-3 flex justify-between border-t pt-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
