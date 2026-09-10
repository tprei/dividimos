"use client";

import type { GroupSnapshot } from "@/types/ledger";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
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
    <div className={cn(className)}>
      <SelectField
        label="Grupo"
        hideLabel
        value={selectedValue}
        options={[
          { value: "", label: "Escolha um grupo" },
          ...groups.map((group) => ({
            value: group.group.id,
            label: group.group.name,
          })),
          { value: "create", label: "Novo grupo…" },
          ...(dmEligible
            ? [{ value: "dm", label: "Conversa direta" }]
            : []),
        ]}
        onChange={(nextValue) => {
          onSelect(nextValue || null);
          onToggleCreateGroup(nextValue === "create");
        }}
      />
      {showCreateName && (
        <Input
          aria-label="Nome do grupo"
          placeholder="Nome do grupo"
          value={createValue}
          onChange={(event) => onCreateValueChange(event.target.value)}
          className="mt-2 h-11 rounded-xl"
        />
      )}
    </div>
  );
}
