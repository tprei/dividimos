import { Skeleton } from "@/components/shared/skeleton";

export default function JoinLoading() {
  return (
    <div className="mx-auto max-w-lg px-4 py-6" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-5 w-32 rounded-md" />
      </div>
      <div className="mt-6 rounded-2xl border bg-card p-5">
        <Skeleton className="h-4 w-40 rounded-md" />
        <Skeleton className="mt-3 h-8 w-56 rounded-md" />
        <Skeleton className="mt-3 h-4 w-48 rounded-md" />
      </div>
    </div>
  );
}
