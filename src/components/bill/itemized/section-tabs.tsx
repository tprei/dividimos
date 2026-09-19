"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
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
  const listRef = useRef<HTMLDivElement>(null);
  const [moreToRight, setMoreToRight] = useState(false);

  const syncOverflow = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setMoreToRight(list.scrollWidth - list.clientWidth - list.scrollLeft > 1);
  }, []);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    syncOverflow();
  }, [section, syncOverflow]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [syncOverflow]);

  return (
    <div className="relative">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Seções da conta"
        onScroll={syncOverflow}
        className="sticky top-0 z-10 mt-3 flex overflow-x-auto border-b bg-background px-2 pr-7"
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
      {moreToRight && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-gradient-to-l from-background pl-3 pr-1 text-muted-foreground"
        >
          <ChevronRight className="size-4" />
        </span>
      )}
    </div>
  );
}
