"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";
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


export function GroupAvatarEditor({
  groupId,
  open,
  onOpenChange,
  anchor,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor?: HTMLElement | null;
}) {
  const group = useAppStore((state) => state.groups[groupId]);
  const [selection, setSelection] = useState<Selection>({ kind: "initials" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const previousPreview = useRef<string | null>(null);

  const current = group?.overview?.avatar ?? { kind: "initials" };
  const dirty = selection.kind !== current.kind ||
    (selection.kind === "emoji" && current.kind === "emoji" && selection.emoji !== current.emoji) ||
    (selection.kind === "photo" && selection.file !== null);

  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);
  useEffect(() => {
    if (!open) return;
    setSelection(selectionFromAvatar(group?.overview?.avatar));
    setError(null);
    setDiscardOpen(false);
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
      haptics.success();
      onOpenChange(false);
    } catch (cause) {
      haptics.error();
      const message = ledgerErrorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const name = group?.group.name ?? "Grupo";

  return (
    <Popover
      open={open}
      dismissable={!saving}
      onOpenChange={(next) => {
        if (!next && dirty) setDiscardOpen(true);
        else onOpenChange(next);
      }}
    >
      <PopoverContent anchor={anchor}>
      {discardOpen ? (
        <>
          <PopoverTitle>Descartar alterações?</PopoverTitle>
          <Button variant="outline" onClick={() => setDiscardOpen(false)}>Continuar editando</Button>
          <Button variant="destructive" onClick={() => onOpenChange(false)}>Descartar</Button>
        </>
      ) : <div data-testid="group-avatar-editor">
        <PopoverTitle>Foto do grupo</PopoverTitle>

        <div className="mt-3 grid gap-3">
          {selection.kind === "photo" && selection.previewUrl !== "" && (
            <Image src={selection.previewUrl} alt={name} width={64} height={64} unoptimized className="mx-auto size-16 rounded-full object-cover" />
          )}

            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Emoji do grupo">
              {AVATAR_EMOJI.map(({ emoji, label }) => {
                const selected = selection.kind === "emoji" && selection.emoji === emoji;
                return (
                  <label key={emoji} className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer text-2xl focus-within:ring-2 focus-within:ring-ring", selected && "border-primary bg-primary/10")}>
                    <input
                      type="radio"
                      name="group-avatar-emoji"
                      className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
                      aria-label={label}
                      checked={selected}
                      disabled={saving}
                      onChange={() => {
                        haptics.selectionChanged();
                        setSelection({ kind: "emoji", emoji });
                        setError(null);
                      }}
                    />
                    {emoji}
                  </label>
                );
              })}
            </div>

          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-dashed px-3 text-sm font-semibold focus-within:ring-2 focus-within:ring-ring">
            Trocar foto
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </label>

          {error && (
            <p className="text-sm text-destructive-text" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() => {
              haptics.selectionChanged();
              setSelection({ kind: "initials" });
              setError(null);
            }}
            disabled={saving}
          >
            Remover
          </Button>
          <Button type="button" className="min-h-11 flex-1" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>}
      </PopoverContent>
    </Popover>
  );
}
