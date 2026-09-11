"use client";

import { useEffect, useRef } from "react";
import type { ItemizedSectionKey } from "@/components/bill/itemized-bill-form";

const SECTION_TABS: { key: ItemizedSectionKey; label: string }[] = [
  { key: "account", label: "Conta" },
  { key: "items", label: "Itens" },
  { key: "split", label: "Quem consumiu" },
  { key: "payment", label: "Pagamento" },
  { key: "review", label: "Revisão" },
];

export interface SectionTabsProps {
  section: ItemizedSectionKey;
  onChange: (section: ItemizedSectionKey) => void;
}

export function SectionTabs({ section, onChange }: SectionTabsProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [section]);

  return (
    <div
      role="tablist"
      aria-label="Seções da conta"
      className="sticky top-0 z-10 mt-3 flex overflow-x-auto border-b bg-background px-2"
    >
      {SECTION_TABS.map((tab) => {
        const active = section === tab.key;
        return (
          <button
            key={tab.key}
            ref={active ? activeRef : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-semibold transition-colors ${active ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
