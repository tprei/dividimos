"use client";

import { ChevronDown } from "lucide-react";
import type { GroupSnapshot } from "@/types/ledger";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface GroupSelectProps {
  value: string | null;
  groups: GroupSnapshot[];
  onSelect: (groupId: string | null) => void;
  createValue: string;
  onCreateValueChange: (name: string) => void;
  createGroupEnabled: boolean;
  onToggleCreateGroup: (enabled: boolean) => void;
  dmEligible: boolean;
  className?: string;
}

export function GroupSelect({
  value,
  groups,
  onSelect,
  createValue,
  onCreateValueChange,
  createGroupEnabled,
  onToggleCreateGroup,
  dmEligible,
  className,
}: GroupSelectProps) {
  const selectedValue = value ?? "";
  const showCreateName = selectedValue === "create" && createGroupEnabled;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <select
          aria-label="Grupo"
          value={selectedValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            onSelect(nextValue || null);
            onToggleCreateGroup(nextValue === "create");
          }}
          className="h-11 w-full min-w-0 appearance-none rounded-xl border border-input bg-transparent px-3 pr-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Escolha um grupo</option>
          {groups.map((group) => (
            <option key={group.group.id} value={group.group.id}>
              {group.group.name}
            </option>
          ))}
          <option value="create">Novo grupo…</option>
          {dmEligible && <option value="dm">Conversa direta</option>}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {showCreateName && (
        <Input
          aria-label="Nome do grupo"
          placeholder="Nome do grupo"
          value={createValue}
          onChange={(event) => onCreateValueChange(event.target.value)}
          className="h-11 rounded-xl"
        />
      )}
    </div>
  );
}
