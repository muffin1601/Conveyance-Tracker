import { Skeleton } from "@/components/ui";

/** Immediate feedback while a navigation is waiting for server data. */
export default function AppLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading page">
      <div className="card space-y-4 p-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="h-11 w-full" />
      </div>
      <div className="card space-y-3 p-4">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
