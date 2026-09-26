import { ScreenHeader } from "@/components/shared/screen-header";
import { Skeleton } from "@/components/shared/skeleton";

export function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader title="Perfil" action={<Skeleton className="size-10 rounded-full" />} />
      <div role="status" aria-label="Carregando" className="px-4 pb-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex h-7 items-center"><Skeleton className="h-5 w-32 max-w-full" /></div>
            <div className="flex h-5 items-center"><Skeleton className="h-3 w-24 max-w-full" /></div>
            <div className="flex h-4 items-center"><Skeleton className="h-3 w-40 max-w-full" /></div>
          </div>
          <Skeleton className="size-10 shrink-0 rounded-xl" />
        </div>
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Chave Pix</h2>
          <div className="rounded-2xl border bg-card">
            <div className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-36 max-w-full" />
            </div>
            <div className="px-4 pb-3"><Skeleton className="h-11 w-full rounded-xl" /></div>
          </div>
        </div>
        {[
          { title: "Preferências", rows: 3 },
          { title: "Segurança", rows: 2 },
        ].map(({ title, rows }) => (
          <div key={title} className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
            <div className="space-y-1 overflow-hidden rounded-2xl border bg-card">
              {Array.from({ length: rows }, (_, row) => (
                <div key={row}>
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-5" />
                      <div className="flex h-6 items-center"><Skeleton className="h-4 w-28" /></div>
                    </div>
                    <Skeleton className={title === "Preferências" && row === 0 ? "h-5 w-9 rounded-full" : "size-4"} />
                  </div>
                  {title === "Preferências" && row < rows - 1 && <div className="mt-1 h-px bg-border" />}
                </div>
              ))}
            </div>
          </div>
        ))}
        <Skeleton className="mt-8 h-10 w-full rounded-xl" />
      </div>
    </div>
  );
}
