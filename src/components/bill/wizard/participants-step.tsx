"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Users2, X } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { PeoplePicker } from "@/components/bill/people-picker";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectionMark } from "@/components/ui/selection-mark";
import { haptics } from "@/hooks/use-haptics";
import { fade, popIn } from "@/lib/animations";
import type { User } from "@/types";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";

export interface ParticipantsStepProps {
  me: Me;
  participants: User[];
  guests: { id: string; name: string }[];
  selectedGroupId: string | null;
  groups: GroupSnapshot[];
  createGroup: { enabled: boolean; name: string };
  onToggleCreateGroup: (enabled: boolean) => void;
  onCreateGroupName: (name: string) => void;
  onSelectGroup: (groupId: string | null) => void;
  onAddParticipant: (user: UserProfile) => void;
  onRemoveParticipant: (id: string) => void;
  onAddGuest: (name: string, phone?: string) => void;
  onRemoveGuest: (id: string) => void;
  hasContactPicker: boolean;
  onPickContacts: () => Promise<void>;
  showGroupPicker?: boolean;
}

export function ParticipantsStep({
  me,
  participants,
  guests,
  selectedGroupId,
  groups,
  createGroup,
  onToggleCreateGroup,
  onCreateGroupName,
  onSelectGroup,
  onAddParticipant,
  onRemoveParticipant,
  onAddGuest,
  onRemoveGuest,
  onPickContacts,
  hasContactPicker,
  showGroupPicker = true,
}: ParticipantsStepProps) {
  const [pickingContacts, setPickingContacts] = useState(false);
  const reduceMotion = useReducedMotion();

  const handlePickContacts = async () => {
    setPickingContacts(true);
    try {
      await onPickContacts();
    } catch (err) {
      console.error("Contact picker failed:", err);
      toast.error("Não foi possível abrir os contatos. Tente novamente.");
    } finally {
      setPickingContacts(false);
    }
  };

  const selectedGroup = groups.find((g) => g.group.id === selectedGroupId) ?? null;
  const memberRows = selectedGroup
    ? selectedGroup.members.filter((m) => m.userId !== me.id)
    : [];
  const addedRows = participants.filter(
    (p) => p.id !== me.id && !memberRows.some((m) => m.userId === p.id),
  );
  const othersCount = participants.filter((p) => p.id !== me.id).length;
  const isSingleUserNoGuests = othersCount === 1 && guests.length === 0;

  return (
    <div className="space-y-3">
      {showGroupPicker && selectedGroup && (
        <div className="flex min-h-12 items-center gap-2.5 rounded-[0.75rem] border border-border bg-card px-3">
          <Users2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={selectedGroup.group.name}>
              {selectedGroup.group.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedGroup.members.length}{" "}
              {selectedGroup.members.length === 1 ? "pessoa" : "pessoas"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelectGroup(null)}
            aria-label="Remover grupo selecionado"
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive-text"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {showGroupPicker && !selectedGroup && groups.length > 0 && (
        <div className="space-y-1.5">
          <p className="px-1 text-xs font-semibold text-muted-foreground">Escolher um grupo existente</p>
          <div className="divide-y divide-border overflow-hidden rounded-[0.75rem] border border-border bg-card">
            {groups.map((g) => (
              <button
                key={g.group.id}
                type="button"
                onClick={() => {
                  haptics.selectionChanged();
                  onSelectGroup(g.group.id);
                }}
                className="flex min-h-12 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/40"
              >
                <Users2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={g.group.name}>
                  {g.group.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {g.members.length} {g.members.length === 1 ? "pessoa" : "pessoas"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {showGroupPicker && selectedGroup && (
          <p className="px-1 text-xs font-semibold text-muted-foreground">
            Quem participou desta conta?
          </p>
        )}
        <div className="divide-y divide-border overflow-hidden rounded-[0.75rem] border border-border bg-card">
          <div className="flex min-h-12 items-center gap-2.5 px-3">
            <UserAvatar id={me.id} name={me.name} avatarUrl={me.avatarUrl} size="sm" isBot={me.isBot} />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={me.name}>
              {me.name}
            </p>
            <Chip>Você</Chip>
            {selectedGroup && <SelectionMark selected />}
          </div>
          {memberRows.map((m) => {
            const isChecked = participants.some((p) => p.id === m.userId);
            const isInvited = m.status === "invited";
            return (
              <button
                key={m.userId}
                type="button"
                aria-pressed={isChecked}
                onClick={() => {
                  haptics.selectionChanged();
                  if (isChecked) onRemoveParticipant(m.userId);
                  else onAddParticipant(m.user);
                }}
                className="flex min-h-12 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-muted/40"
              >
                <UserAvatar id={m.userId} name={m.user.name} avatarUrl={m.user.avatarUrl} size="sm" isBot={m.user.isBot} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={m.user.name}>
                  {m.user.name}
                </span>
                {isInvited && <Chip tone="warning">Convite pendente</Chip>}
                <SelectionMark selected={isChecked} />
              </button>
            );
          })}
          {addedRows.map((p) => (
            <div key={p.id} className="flex min-h-12 items-center gap-2.5 px-3">
              <UserAvatar id={p.id} name={p.name} avatarUrl={p.avatarUrl} size="sm" />
              <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={p.name}>
                {p.name}
              </p>
              <button
                type="button"
                onClick={() => {
                  haptics.selectionChanged();
                  onRemoveParticipant(p.id);
                }}
                aria-label={`Remover ${p.name}`}
                className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive-text"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ))}
          <AnimatePresence initial={false}>
            {guests.map((g) => (
              <motion.div
                key={g.id}
                variants={reduceMotion ? fade : popIn}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="flex min-h-12 items-center gap-2.5 px-3"
              >
                <GuestAvatar id={g.id} name={g.name} size="sm" />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={g.name}>
                  {g.name}
                </p>
                <Chip tone="guest">Convidado</Chip>
                <button
                  type="button"
                  onClick={() => {
                    haptics.selectionChanged();
                    onRemoveGuest(g.id);
                  }}
                  aria-label={`Remover ${g.name}`}
                  className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive-text"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <PeoplePicker
        me={me}
        selectedIds={participants.map((p) => p.id)}
        showSuggestions={!selectedGroup}
        onAddPerson={onAddParticipant}
        onAddGuest={(name) => onAddGuest(name)}
      />

      {hasContactPicker && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11"
          onClick={handlePickContacts}
          disabled={pickingContacts}
        >
          <Users2 className="size-4" aria-hidden="true" />
          Dos contatos do celular
        </Button>
      )}

      {showGroupPicker && !selectedGroupId && !isSingleUserNoGuests && (
        <div className="rounded-[0.75rem] border border-border bg-card px-3 py-2.5">
          <label className="flex min-h-11 items-center gap-2.5">
            <input
              type="checkbox"
              checked={createGroup.enabled}
              onChange={(e) => onToggleCreateGroup(e.target.checked)}
              className="size-4 accent-primary"
            />
            <span className="text-sm font-medium">Criar grupo com essas pessoas</span>
          </label>
          {createGroup.enabled && (
            <Input
              type="text"
              placeholder="Nome do grupo"
              value={createGroup.name}
              onChange={(e) => onCreateGroupName(e.target.value)}
              className="mt-2"
            />
          )}
        </div>
      )}
    </div>
  );
}
