import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  variant?: "pulse" | "shimmer";
}

export function Skeleton({ className, variant = "pulse" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md",
        variant === "shimmer"
          ? "bg-[length:200%_100%] bg-[linear-gradient(90deg,var(--muted)_0%,var(--muted-foreground)/12%_50%,var(--muted)_100%)] [animation:shimmer_1.8s_ease-in-out_infinite]"
          : "animate-pulse bg-muted",
        className,
      )}
    />
  );
}

export function ContactAvatarSkeleton({
  variant = "shimmer",
}: {
  variant?: "pulse" | "shimmer";
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Skeleton variant={variant} className="h-8 w-8 rounded-full" />
      <Skeleton variant={variant} className="h-2.5 w-10" />
    </div>
  );
}

export function ContactRowSkeleton({
  variant = "shimmer",
}: {
  variant?: "pulse" | "shimmer";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl p-2">
      <Skeleton variant={variant} className="h-8 w-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton variant={variant} className="h-3.5 w-24" />
        <Skeleton variant={variant} className="h-3 w-16" />
      </div>
    </div>
  );
}

export function GroupRowSkeleton({
  variant = "shimmer",
}: {
  variant?: "pulse" | "shimmer";
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton variant={variant} className="h-9 w-9 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-1.5">
        <Skeleton variant={variant} className="h-3.5 w-28" />
        <Skeleton variant={variant} className="h-3 w-20" />
      </div>
      <div className="flex -space-x-1.5">
        {[1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            variant={variant}
            className="h-6 w-6 rounded-full border-2 border-card"
          />
        ))}
      </div>
    </div>
  );
}

export function ActivityCardSkeleton({
  variant = "shimmer",
}: {
  variant?: "pulse" | "shimmer";
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <Skeleton variant={variant} className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton variant={variant} className="h-4 w-3/4" />
        <Skeleton variant={variant} className="h-3 w-1/2" />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton variant={variant} className="ml-auto h-4 w-16" />
        <Skeleton variant={variant} className="ml-auto h-4 w-12 rounded-full" />
      </div>
    </div>
  );
}

export function ModalLoadingSkeleton({
  variant = "shimmer",
}: {
  variant?: "pulse" | "shimmer";
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
      <Skeleton variant={variant} className="h-3.5 w-32" />
    </div>
  );
}

export function BillCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4">
      <Skeleton className="h-11 w-11 rounded-xl" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton className="ml-auto h-4 w-16" />
        <Skeleton className="ml-auto h-4 w-12 rounded-full" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
      <Skeleton className="h-12 rounded-xl" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        {[1, 2, 3].map((i) => (
          <BillCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
