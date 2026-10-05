import { ScanLine } from "lucide-react";
import { ItemIcon } from "@/components/shared/item-icon";

export function ReceiptCaptureArt({ reading = false }: { reading?: boolean }) {
  return (
    <div aria-hidden="true" className="relative mx-auto flex h-72 w-full max-w-xs items-center justify-center compact:h-52">
      <div className="absolute size-60 rounded-full bg-primary/10 compact:size-44" />
      <div className="absolute left-4 top-12 size-11 rounded-tl-2xl border-l-2 border-t-2 border-primary/60" />
      <div className="absolute bottom-10 right-4 size-11 rounded-br-2xl border-b-2 border-r-2 border-primary/60" />
      <div className="relative w-44 -rotate-6 rounded-t-xl border border-border bg-card p-5 shadow-lg motion-reduce:rotate-0">
        <div className="mx-auto mb-2 h-2 w-16 rounded-full bg-foreground/70" />
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="space-y-3 border-y border-dashed border-border py-4">
          {["pao_de_queijo", "coffee", "juice"].map((icon) => (
            <div key={icon} className="flex items-center gap-3">
              <ItemIcon icon={icon} />
              <div className="h-1.5 flex-1 rounded-full bg-muted-foreground/25" />
              <div className="h-1.5 w-5 rounded-full bg-muted-foreground/40" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="h-2 w-10 rounded-full bg-muted-foreground/40" />
          <div className="h-3 w-12 rounded-full bg-primary/70" />
        </div>
        <svg viewBox="0 0 176 10" className="absolute -bottom-2 left-0 h-2.5 w-full fill-card text-border" preserveAspectRatio="none">
          <path d="M0 0H176V2L168 9L160 2L152 9L144 2L136 9L128 2L120 9L112 2L104 9L96 2L88 9L80 2L72 9L64 2L56 9L48 2L40 9L32 2L24 9L16 2L8 9L0 2Z" />
          <path d="M0 2L8 9L16 2L24 9L32 2L40 9L48 2L56 9L64 2L72 9L80 2L88 9L96 2L104 9L112 2L120 9L128 2L136 9L144 2L152 9L160 2L168 9L176 2" fill="none" stroke="currentColor" />
        </svg>
      </div>
      <div className="absolute bottom-9 right-8 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm compact:bottom-2">
        <ScanLine className={reading ? "size-7 motion-safe:animate-pulse" : "size-7"} />
      </div>
    </div>
  );
}
