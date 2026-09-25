"use client";

import { ChargeHistoryList } from "@/components/dashboard/charge-history-list";
import { ScreenHeader } from "@/components/shared/screen-header";

export default function ChargesPage() {
  return <div className="mx-auto max-w-lg md:max-w-2xl"><ScreenHeader back title="Cobranças" /><div className="px-4 pb-6"><ChargeHistoryList embedded /></div></div>;
}
