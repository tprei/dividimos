"use client";

import type { Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";

export function useMe(): Me | null {
  return useAppStore((s) => s.me);
}
