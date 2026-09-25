"use client";

import { ScanLine } from "lucide-react";
import { Skeleton } from "@/components/shared/skeleton";

export function ScanSkeletonLoader() {
  return (
    <div className="mx-auto w-full max-w-sm space-y-4 py-6" role="status" aria-label="Lendo a nota">
      <div className="flex items-center justify-center gap-2 text-sm font-semibold">
        <ScanLine className="size-5 text-primary motion-safe:animate-pulse" />
        Lendo a nota…
      </div>
      <div aria-hidden="true" className="space-y-6 rounded-t-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-3 border-b border-dashed pb-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="space-y-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-6">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
        <div className="flex justify-between border-t border-dashed pt-6">
          <Skeleton className="h-5 w-16" /><Skeleton className="h-6 w-24" />
        </div>
      </div>
    </div>
  );
}
