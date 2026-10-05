"use client";

import { ReceiptCaptureArt } from "@/components/bill/receipt-capture-art";
import { Skeleton } from "@/components/shared/skeleton";

export function ScanSkeletonLoader() {
  return (
    <div className="mx-auto flex min-h-[calc(var(--app-viewport-height)-8rem)] w-full max-w-sm flex-col items-center justify-center gap-6 pb-[max(1rem,env(safe-area-inset-bottom))]" role="status" aria-label="Lendo a nota">
      <ReceiptCaptureArt reading />
      <h2 className="text-xl font-bold tracking-tight">Lendo a nota…</h2>
      <div aria-hidden="true" className="flex items-center gap-2">
        <Skeleton className="size-2 rounded-full bg-primary/60" />
        <Skeleton className="size-2 rounded-full bg-primary/40" />
        <Skeleton className="size-2 rounded-full bg-primary/20" />
      </div>
    </div>
  );
}
