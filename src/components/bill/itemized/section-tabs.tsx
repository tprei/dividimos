"use client";

import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";

const SECTION_TABS: { key: ItemizedSectionKey; label: string }[] = [
  { key: "items", label: "Itens" },
  { key: "split", label: "Divisão" },
  { key: "payment", label: "Pagamento" },
  { key: "review", label: "Revisão" },
];

export interface SectionTabsProps {
  section: ItemizedSectionKey;
  onChange: (section: ItemizedSectionKey) => void;
}

export function SectionTabs({ section, onChange }: SectionTabsProps) {
  return (
    <div role="tablist" aria-label="Seções da conta" className="sticky top-0 z-10 mt-3 flex gap-1 overflow-x-auto border-b bg-background px-4">
      {SECTION_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={section === tab.key}
          onClick={() => onChange(tab.key)}
          className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${section === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
