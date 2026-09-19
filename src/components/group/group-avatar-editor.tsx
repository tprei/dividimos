"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { AnchoredPopover } from "@/components/shared/anchored-popover";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { updateGroupAvatar, type GroupAvatarUpdate } from "@/lib/sync/group-avatar";
import { useAppStore } from "@/stores/app-store";
import type { GroupAvatar as GroupAvatarData } from "@/types/ledger";

const AVATAR_EMOJI = [
  { emoji: "🏠", label: "Casa" },
  { emoji: "🍻", label: "Brinde" },
  { emoji: "🍕", label: "Pizza" },
  { emoji: "🏖️", label: "Praia" },
  { emoji: "✈️", label: "Viagem" },
  { emoji: "⚽", label: "Futebol" },
  { emoji: "🎉", label: "Festa" },
  { emoji: "🐱", label: "Gato" },
];
type Selection =
  | { kind: "initials" }
  | { kind: "emoji"; emoji: string }
  | { kind: "photo"; file: File | null; previewUrl: string; photoId: string | null };
function selectionFromAvatar(avatar: GroupAvatarData | undefined): Selection {
  if (avatar?.kind === "emoji") return avatar;
  if (avatar?.kind === "photo") {
    return { kind: "photo", file: null, previewUrl: "", photoId: avatar.photoId };
  }
  return { kind: "initials" };
}

function selectionPreview(groupId: string, name: string, selection: Selection): ReactNode {
  if (selection.kind === "photo" && selection.previewUrl !== "") {
    return (
      <Image
        src={selection.previewUrl}
        alt={name}
        width={80}
        height={80}
        unoptimized
        className="size-20 rounded-full object-cover"
      />
    );
  }
  if (selection.kind === "photo" && selection.photoId !== null) {
    return <GroupAvatar name={name} groupId={groupId} avatar={{ kind: "photo", photoId: selection.photoId }} size="lg" />;
  }
  if (selection.kind === "emoji") {
    return <GroupAvatar name={name} groupId={groupId} avatar={selection} size="lg" />;
  }
  return <GroupAvatar name={name} groupId={groupId} avatar={{ kind: "initials" }} size="lg" />;
}

export function GroupAvatarEditor({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const group = useAppStore((state) => state.groups[groupId]);
  const [selection, setSelection] = useState<Selection>({ kind: "initials" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousPreview = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelection(selectionFromAvatar(group?.overview?.avatar));
    setError(null);
  }, [open, group?.overview?.avatar]);

  useEffect(() => {
    const currentPreview = selection.kind === "photo" ? selection.previewUrl : "";
    if (previousPreview.current !== null && previousPreview.current !== currentPreview) {
      URL.revokeObjectURL(previousPreview.current);
    }
    previousPreview.current = currentPreview === "" ? null : currentPreview;
    return () => {
      if (previousPreview.current === currentPreview && currentPreview !== "") {
        URL.revokeObjectURL(currentPreview);
        previousPreview.current = null;
      }
    };
  }, [selection]);

  useEffect(
    () => () => {
      if (previousPreview.current !== null) URL.revokeObjectURL(previousPreview.current);
    },
    [],
  );

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setSelection({
      kind: "photo",
      file,
      previewUrl: URL.createObjectURL(file),
      photoId: null,
    });
    setError(null);
  };

  const handleSave = async () => {
    if (saving) return;
    if (selection.kind === "photo" && selection.file === null) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const update: GroupAvatarUpdate =
        selection.kind === "photo"
          ? { kind: "photo", file: selection.file! }
          : selection;
      await updateGroupAvatar(groupId, update);
      onOpenChange(false);
    } catch (cause) {
      const message = ledgerErrorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const name = group?.group.name ?? "Grupo";

  return (
    <AnchoredPopover
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Editar imagem do grupo"
      className="left-0 top-[calc(100%+0.5rem)] w-[min(20rem,calc(100vw-2rem))] rounded-2xl p-4"
    >
      <div data-testid="group-avatar-editor">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Imagem do grupo</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha um emoji ou uma foto para reconhecer o grupo.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label="Fechar editor de imagem"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-5 grid gap-5">
          <div className="flex justify-center">{selectionPreview(groupId, name, selection)}</div>

          <div>
            <p className="mb-2 text-sm font-medium">Emoji</p>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Emoji do grupo">
              {AVATAR_EMOJI.map(({ emoji, label }) => {
                const selected = selection.kind === "emoji" && selection.emoji === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    className={`flex min-h-12 items-center justify-center rounded-xl border text-2xl ${selected ? "border-primary bg-primary/10" : "border-border"}`}
                    onClick={() => {
                      setSelection({ kind: "emoji", emoji });
                      setError(null);
                    }}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed px-3 text-sm font-medium">
            Escolher foto
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </label>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() => {
              setSelection({ kind: "initials" });
              setError(null);
            }}
            disabled={saving}
          >
            Usar iniciais
          </Button>
          <Button type="button" className="min-h-11 flex-1" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </AnchoredPopover>
  );
}
