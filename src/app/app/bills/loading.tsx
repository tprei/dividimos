import { BillCardSkeleton, Skeleton } from "@/components/shared/skeleton";

export default function Loading() {
  return (
    <div className="px-4 py-6 space-y-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-10 rounded-xl" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <BillCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
