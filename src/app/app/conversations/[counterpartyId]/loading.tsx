import { Skeleton } from "@/components/shared/skeleton";

export default function Loading() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border/50 px-3 py-2.5">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="flex-1 space-y-4 px-4 py-6">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-48 rounded-2xl" />
        </div>
        <div className="flex justify-start">
          <Skeleton className="h-10 w-56 rounded-2xl" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-40 rounded-2xl" />
        </div>
      </div>
      <div className="border-t px-4 py-3">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}
