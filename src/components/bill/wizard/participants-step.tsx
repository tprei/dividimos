"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, UserPlus, Users, Users2, X } from "lucide-react";
import { useState } from "react";
import { GroupSelector } from "@/components/bill/group-selector";
import { AddParticipantByHandle } from "@/components/bill/add-participant-by-handle";
import { RecentContacts } from "@/components/bill/recent-contacts";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { User, UserProfile } from "@/types";

export interface ParticipantsStepProps {
  authUser: User | null;
  participants: User[];
  guests: { id: string; name: string }[];
  selectedGroupId: string | null;
  selectedGroupName: string | null;
  groupMembers: UserProfile[];
  hasContactPicker: boolean;
  onSelectGroup: (groupId: string, groupName: string, members: UserProfile[]) => void;
  onDeselectGroup: () => void;
  onAddParticipant: (user: User) => void;
  onRemoveParticipant: (id: string) => void;
  onAddGuest: (name: string, phone?: string) => void;
  onRemoveGuest: (id: string) => void;
  onPickContacts: () => Promise<void>;
}

export function ParticipantsStep({
  authUser,
  participants,
  guests,
  selectedGroupId,
  selectedGroupName,
  groupMembers,
  hasContactPicker,
  onSelectGroup,
  onDeselectGroup,
  onAddParticipant,
  onRemoveParticipant,
  onAddGuest,
  onRemoveGuest,
  onPickContacts,
}: ParticipantsStepProps) {
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [guestNameInput, setGuestNameInput] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {selectedGroupId
          ? "Participantes do grupo selecionado."
          : "Adiciona a galera pelo @handle ou escolhe um grupo."}
      </p>

      <GroupSelector
        currentUserId={authUser?.id ?? ""}
        excludeIds={[]}
        selectedGroupId={selectedGroupId}
        selectedGroupName={selectedGroupName}
        onSelectGroup={onSelectGroup}
        onDeselectGroup={onDeselectGroup}
      />

      <div className="space-y-2">
        {selectedGroupId && groupMembers.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">Quem participou desta conta?</p>
            <div
              key={authUser?.id}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
            >
              <input type="checkbox" checked disabled className="h-4 w-4 accent-primary" />
              <UserAvatar name={authUser?.name ?? ""} avatarUrl={authUser?.avatarUrl} size="sm" />
              <div className="flex-1">
                <p className="text-sm font-medium">{authUser?.name}</p>
                <p className="text-xs text-muted-foreground">@{authUser?.handle}</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Você</span>
            </div>
            {groupMembers.map((m) => {
              const isChecked = participants.some((p) => p.id === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (isChecked) {
                      onRemoveParticipant(m.id);
                    } else {
                      onAddParticipant({
                        id: m.id,
                        email: "",
                        handle: m.handle,
                        name: m.name,
                        pixKeyType: "email",
                        pixKeyHint: "",
                        avatarUrl: m.avatarUrl,
                        onboarded: true,
                        createdAt: new Date().toISOString(),
                      });
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/30"
                >
                  <input type="checkbox" checked={isChecked} readOnly className="h-4 w-4 accent-primary pointer-events-none" />
                  <UserAvatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">@{m.handle}</p>
                  </div>
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
              {p.id === authUser?.id ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Você</span>
              ) : (
                <button onClick={() => onRemoveParticipant(p.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
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
              <button onClick={() => onRemoveGuest(g.id)} className="rounded-lg p-1 text-muted-foreground hover:text-destructive">
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

      {!selectedGroupId && (
        <>
          <RecentContacts
            onSelect={(profile) => {
              onAddParticipant({
                id: profile.id,
                email: "",
                handle: profile.handle,
                name: profile.name,
                pixKeyType: "email",
                pixKeyHint: "",
                avatarUrl: profile.avatarUrl,
                onboarded: true,
                createdAt: new Date().toISOString(),
              });
            }}
            excludeIds={participants.map((p) => p.id)}
            currentUserId={authUser?.id ?? ""}
          />
          <AnimatePresence>
            {showAddParticipant && (
              <AddParticipantByHandle
                onAdd={(profile: UserProfile) => {
                  onAddParticipant({
                    id: profile.id,
                    email: "",
                    handle: profile.handle,
                    name: profile.name,
                    pixKeyType: "email",
                    pixKeyHint: "",
                    avatarUrl: profile.avatarUrl,
                    onboarded: true,
                    createdAt: new Date().toISOString(),
                  });
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
                <Button variant="outline" className="w-full gap-2" onClick={onPickContacts}>
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
        </>
      )}

      {selectedGroupId && !showAddGuest && (
        <div className="flex flex-col gap-2">
          {hasContactPicker && (
            <Button variant="outline" className="w-full gap-2" onClick={onPickContacts}>
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
    </div>
  );
}
