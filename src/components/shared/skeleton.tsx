import { Logo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  /** `static` holds still: a placeholder for something not asked for yet, not something loading. */
  variant?: "pulse" | "shimmer" | "static";
}

const skeletonMotion: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  pulse: "motion-safe:animate-pulse",
  shimmer: "bg-[length:200%_100%] bg-[linear-gradient(90deg,var(--muted),var(--card),var(--muted))] motion-safe:[animation:shimmer_1.8s_ease-in-out_infinite]",
  static: "",
};

export function Skeleton({ className, variant = "pulse" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-lg bg-muted motion-reduce:animate-none", skeletonMotion[variant], className)}
    />
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
    <div role="status" aria-label="Carregando" className="flex flex-col items-center justify-center gap-4 py-12">
      <div aria-hidden="true" className="relative h-10 w-10">
        <div className="absolute inset-0 motion-safe:animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
      <Skeleton variant={variant} className="h-3.5 w-32" />
    </div>
  );
}

export function BillCardSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="flex items-center gap-4 rounded-2xl border bg-card p-4">
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
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-8 compact:space-y-3">
      <header className="flex items-center justify-between pt-4 compact:pt-2" aria-hidden="true">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((action) => <Skeleton key={action} className="size-10 rounded-full" />)}
        </div>
      </header>
      <div role="status" aria-label="Carregando" className="space-y-3 md:grid md:grid-cols-[minmax(0,1fr)_12rem] md:gap-3 md:space-y-0">
        <div className="gradient-mesh rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap-reverse items-end gap-x-3">
            <div className="flex-1">
              <div className="flex h-5 items-center"><Skeleton className="h-4 w-36" /></div>
              <div className="mt-2 flex h-[1.25em] items-center text-4xl"><Skeleton className="h-9 w-44 max-w-full" /></div>
            </div>
            <div className="-mt-1.5 -mr-1.5 ml-auto flex size-11 shrink-0 items-center justify-center"><Skeleton className="size-8 rounded-full" /></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
            {[1, 2].map((detail) => (
              <div key={detail}>
                <div className="flex h-4 items-center"><Skeleton className="h-3 w-16" /></div>
                <div className="flex h-5 items-center"><Skeleton className="h-4 w-20" /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-1 md:content-start">
          {[1, 2, 3].map((action) => (
            <div key={action} className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-[0.75rem] bg-muted px-2 py-2 md:min-h-10 md:flex-row md:justify-start md:gap-2 md:px-3">
              <Skeleton className="size-4 bg-foreground/10" />
              <Skeleton className="h-4 w-20 max-w-full bg-foreground/10" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-6" aria-hidden="true">
        {[2, 3].map((rows, section) => (
          <div key={section}>
            <div className="flex min-h-8 items-center justify-between gap-3 pb-1">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <div className="flex h-5 items-center"><Skeleton className="h-4 w-32 max-w-full" /></div>
                    <div className="flex h-4 items-center"><Skeleton className="h-3 w-24 max-w-full" /></div>
                  </div>
                  <Skeleton className="mt-0.5 h-4 w-14 shrink-0 self-start" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
