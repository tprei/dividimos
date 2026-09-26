import { ScreenHeader } from "@/components/shared/screen-header";
import { ScreenHeaderActionsContext } from "@/components/shared/screen-header-actions";
import { Skeleton } from "@/components/shared/skeleton";

export function NewBillSkeleton() {
  return (
    <div className="mx-auto max-w-lg pb-[max(1.5rem,env(safe-area-inset-bottom))] md:max-w-2xl">
      <ScreenHeaderActionsContext.Provider value={null}>
        <ScreenHeader title="Nova conta" action={<Skeleton className="size-11 rounded-full" />} />
      </ScreenHeaderActionsContext.Provider>
      <div role="status" aria-label="Carregando" className="px-4 pt-3">
        <div className="space-y-4">
          <h2 className="px-1 text-base font-bold tracking-tight">Que tipo de conta?</h2>
          <div className="space-y-2">
            {[1, 2].map((option) => (
              <div key={option} className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5">
                <Skeleton className="size-10 shrink-0 rounded-[0.75rem]" />
                <div className="min-w-0 flex-1">
                  <div className="flex h-6 items-center"><Skeleton className="h-4 w-28" /></div>
                  <div className="flex h-5 items-center"><Skeleton className="h-3 w-48 max-w-full" /></div>
                </div>
                <Skeleton className="size-4 shrink-0" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[1, 2].map((shortcut) => (
              <div key={shortcut} className="flex h-10 items-center justify-center gap-2 rounded-[0.75rem] border border-border px-3">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-4 w-24 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
