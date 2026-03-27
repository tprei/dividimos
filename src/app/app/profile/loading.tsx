import { Skeleton } from "@/components/shared/skeleton";

export default function Loading() {
  return (
    <div className="px-4 py-6 space-y-6">
      <div className="flex flex-col items-center gap-4 py-4">
        <Skeleton className="h-20 w-20 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between rounded-2xl border bg-card p-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
