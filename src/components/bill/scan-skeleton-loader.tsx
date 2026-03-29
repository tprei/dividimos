"use client";

import { motion } from "framer-motion";
import { ScanLine } from "lucide-react";
import { Skeleton } from "@/components/shared/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";

const SKELETON_COUNT = 5;

/**
 * Skeleton shimmer shown while a receipt photo is being processed by Gemini OCR.
 * Mimics the layout of ScannedItemsReview so the transition feels seamless.
 */
export function ScanSkeletonLoader() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Processando nota...</h2>
        <p className="text-sm text-muted-foreground">
          Lendo itens da nota fiscal. Isso pode levar alguns segundos.
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2 py-2">
        <ScanLine className="h-5 w-5 animate-pulse text-primary" />
        <span className="text-sm text-muted-foreground">Analisando imagem...</span>
      </div>

      {/* Merchant skeleton */}
      <div className="rounded-2xl border bg-card p-4">
        <Skeleton className="mb-2 h-3 w-24" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>

      {/* Item skeletons */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <motion.div
            key={i}
            variants={staggerItem}
            className="rounded-2xl border bg-card p-4"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-8" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="ml-2 flex gap-1">
                <Skeleton className="h-7 w-7 rounded-lg" />
                <Skeleton className="h-7 w-7 rounded-lg" />
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Total skeleton */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
    </div>
  );
}
