import { Skeleton } from "@/components/shared/skeleton";

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 gap-6">
      <Skeleton className="h-16 w-16 rounded-2xl" />
      <div className="space-y-2 text-center w-full max-w-xs">
        <Skeleton className="h-6 w-48 mx-auto" />
        <Skeleton className="h-4 w-64 mx-auto" />
      </div>
      <Skeleton className="h-14 w-full max-w-xs rounded-2xl" />
    </div>
  );
}
