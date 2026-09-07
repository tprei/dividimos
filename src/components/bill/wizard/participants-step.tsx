"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, UserPlus, Users, Users2, X } from "lucide-react";
import { useState } from "react";
import { AddParticipantByHandle } from "@/components/bill/add-participant-by-handle";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}: ParticipantsStepProps) {
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState("");

  const selectedGroup = groups.find((g) => g.group.id === selectedGroupId) ?? null;
  const memberRows = selectedGroup
    ? selectedGroup.members.filter((m) => m.userId !== me.id)
    : [];
  const othersCount = participants.filter((p) => p.id !== me.id).length;
  const isSingleUserNoGuests = othersCount === 1 && guests.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {selectedGroupId
          ? "Participantes do grupo selecionado."
          : "Adiciona a galera pelo @handle ou escolhe um grupo."}
      </p>

      {selectedGroup ? (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Users2 className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{selectedGroup.group.name}</p>
            <p className="text-xs text-muted-foreground">
              {selectedGroup.members.length}{" "}
              {selectedGroup.members.length === 1 ? "pessoa" : "pessoas"}
            </p>
          </div>
          <button
            onClick={() => onSelectGroup(null)}
            aria-label="Remover grupo selecionado"
            className="rounded-lg p-1 text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        groups.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Escolher um grupo existente</p>
            {groups.map((g) => (
              <button
                key={g.group.id}
                type="button"
                onClick={() => onSelectGroup(g.group.id)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/30"
              >
                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                  <Users2 className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{g.group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.members.length} {g.members.length === 1 ? "pessoa" : "pessoas"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )
      )}

      <div className="space-y-2">
        {selectedGroup ? (
          <>
            <p className="text-xs text-muted-foreground">Quem participou desta conta?</p>
            <div
              key={me.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
            >
              <input type="checkbox" checked disabled className="h-4 w-4 accent-primary" />
              <UserAvatar name={me.name} avatarUrl={me.avatarUrl} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-medium">{me.name}</p>
                <p className="text-xs text-muted-foreground">@{me.handle}</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Você</span>
            </div>
            {memberRows.map((m) => {
              const isChecked = participants.some((p) => p.id === m.userId);
              const isInvited = m.status === "invited";
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() =>
                    isChecked ? onRemoveParticipant(m.userId) : onAddParticipant(m.user)
                  }
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                >
                  <input type="checkbox" checked={isChecked} readOnly className="h-4 w-4 accent-primary pointer-events-none" />
                  <UserAvatar name={m.user.name} avatarUrl={m.user.avatarUrl} size="sm" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{m.user.name}</p>
                    <p className="text-xs text-muted-foreground">@{m.user.handle}</p>
                  </div>
                  {isInvited && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      convite pendente
                    </span>
                  )}
                </button>
              );
            })}
          </>
        ) : (
          participants.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <UserAvatar name={p.name} avatarUrl={p.avatarUrl} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">@{p.handle}</p>
              </div>
              {p.id === me.id ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Você</span>
              ) : (
                <button onClick={() => onRemoveParticipant(p.id)} aria-label={`Remover ${p.name}`} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {guests.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Convidados (sem conta no Dividimos)</p>
          {guests.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-xl border border-dashed bg-card p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                {g.name.charAt(0)}
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium">{g.name}</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Convidado</span>
              <button onClick={() => onRemoveGuest(g.id)} aria-label={`Remover ${g.name}`} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showAddGuest && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-2xl border border-dashed bg-card p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Adicionar convidado</span>
              <button
                onClick={() => { setShowAddGuest(false); setGuestNameInput(""); }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const name = guestNameInput.trim();
              if (!name) return;
              onAddGuest(name);
              setGuestNameInput("");
            }} className="flex gap-2">
              <Input
                type="text"
                placeholder="Nome do convidado"
                value={guestNameInput}
                onChange={(e) => setGuestNameInput(e.target.value)}
                autoFocus
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={!guestNameInput.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Convidados recebem um link pra confirmar a participação depois.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddParticipant && (
          <AddParticipantByHandle
            onAdd={(profile: UserProfile) => {
              onAddParticipant(profile);
              setShowAddParticipant(false);
            }}
            onCancel={() => setShowAddParticipant(false)}
            excludeIds={participants.map((p) => p.id)}
          />
        )}
      </AnimatePresence>

      {!showAddParticipant && !showAddGuest && (
        <div className="flex flex-col gap-2">
          <Button variant="outline" className="w-full gap-2" onClick={() => setShowAddParticipant(true)}>
            <UserPlus className="h-4 w-4" />
            Por @handle
          </Button>
          {hasContactPicker && (
            <Button variant="outline" className="w-full gap-2" onClick={() => void onPickContacts()}>
              <Users2 className="h-4 w-4" />
              Dos contatos do celular
            </Button>
          )}
          <Button variant="outline" className="w-full gap-2 border-dashed" onClick={() => setShowAddGuest(true)}>
            <Users className="h-4 w-4" />
            Adicionar convidado
          </Button>
        </div>
      )}

      {!selectedGroupId && !isSingleUserNoGuests && (
        <div className="rounded-2xl border bg-card p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={createGroup.enabled}
              onChange={(e) => onToggleCreateGroup(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm font-medium">Criar grupo com essas pessoas</span>
          </label>
          {createGroup.enabled && (
            <div className="mt-3">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Nome do grupo
              </label>
              <Input
                type="text"
                placeholder="Nome do grupo"
                value={createGroup.name}
                onChange={(e) => onCreateGroupName(e.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
