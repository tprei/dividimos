"use client";

import { BillsListContent } from "@/components/bills/bills-list-content";
import { ScreenHeader } from "@/components/shared/screen-header";

export default function BillsPage() {
  return <div className="mx-auto max-w-lg md:max-w-2xl"><ScreenHeader back title="Contas" /><BillsListContent /></div>;
}
