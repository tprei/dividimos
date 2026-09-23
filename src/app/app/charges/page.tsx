"use client";

import { ChargeHistoryList } from "@/components/dashboard/charge-history-list";
import { ScreenHeader } from "@/components/shared/screen-header";

export default function ChargesPage() {
  return <><ScreenHeader back title="Cobranças" /><div className="px-4"><ChargeHistoryList embedded /></div></>;
}
