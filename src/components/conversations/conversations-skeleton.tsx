import { ScreenHeader } from "@/components/shared/screen-header";
import { Skeleton } from "@/components/shared/skeleton";

export function ConversationsSkeleton() {
  return (
    <div className="mx-auto max-w-lg pb-6 md:max-w-2xl">
      <ScreenHeader title="Conversas" action={<Skeleton className="size-11 rounded-full" />} />
      <div className="px-4" aria-hidden="true">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="mt-2 flex border-b border-border">
          {["Todas", "A pagar", "A receber", "Em dia"].map((label) => (
            <div key={label} className="flex h-9 min-w-0 flex-1 items-center justify-center px-1 text-sm font-semibold text-muted-foreground">
              {label}
            </div>
          ))}
        </div>
      </div>
      <div role="status" aria-label="Carregando" className="min-h-[50dvh] px-4 pt-3">
        <div className="divide-y overflow-hidden rounded-2xl border bg-card">
          {[1, 2, 3, 4, 5, 6].map((row) => (
            <div key={row} className="flex min-h-16 items-center gap-3 px-3 py-2.5">
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex h-6 items-center justify-between gap-2">
                  <Skeleton className="h-4 w-28 max-w-full" />
                  <Skeleton className="h-3 w-8 shrink-0" />
                </div>
                <div className="mt-0.5 flex h-5 items-center">
                  <Skeleton className="h-3 w-36 max-w-full" />
                </div>
              </div>
              <Skeleton className="h-4 w-14 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
