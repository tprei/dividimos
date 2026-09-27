import { ScreenHeader } from "@/components/shared/screen-header";
import { Skeleton } from "@/components/shared/skeleton";

export function GroupsSkeleton() {
  return (
    <div>
      <ScreenHeader title="Grupos" action={<Skeleton className="size-10 rounded-full" />} />
      <div role="status" aria-label="Carregando" className="mx-auto max-w-lg space-y-6 px-4 pb-6 md:max-w-2xl">
        <div className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
          {[1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-11 shrink-0 rounded-[28%]" />
              <div className="min-w-0 flex-1">
                <div className="flex h-5 items-center"><Skeleton className="h-4 w-36 max-w-full" /></div>
                <div className="flex h-4 items-center"><Skeleton className="h-3 w-24 max-w-full" /></div>
              </div>
              <div className="space-y-1 self-start">
                <div className="flex h-5 items-center justify-end"><Skeleton className="h-4 w-16" /></div>
                <div className="flex h-4 items-center justify-end"><Skeleton className="h-3 w-12" /></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
