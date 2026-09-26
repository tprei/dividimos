"use client";

import { ArrowLeft, Camera, ImagePlus } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/people";
import { cn } from "@/lib/utils";
import type { GroupAvatar as GroupAvatarData } from "@/types/ledger";

export interface GroupHeroProps {
  groupId: string;
  name: string;
  avatar: GroupAvatarData | undefined;
  /** One line under the name, e.g. "6 membros · desde set. de 2026". */
  meta: string;
  onBack: () => void;
  /** Present only for people who may change the group photo. */
  onEditPhoto?: (anchor: HTMLElement) => void;
}

const PHOTO_CHROME = "bg-black/35 text-white hover:bg-black/50 hover:text-white";
const BAND_CHROME = "border border-border bg-card/80 text-foreground hover:bg-card";

/**
 * The group's header: a full-bleed photo with the name laid over it, or,
 * without a photo, a warm band carrying the emoji/initials large. Both keep
 * the same corners: back top-left, photo editor top-right, identity at the
 * bottom.
 */
export function GroupHero({ groupId, name, avatar, meta, onBack, onEditPhoto }: GroupHeroProps) {
  const [failedPhotoId, setFailedPhotoId] = useState<string | null>(null);
  const photoId = avatar?.kind === "photo" && avatar.photoId !== failedPhotoId ? avatar.photoId : null;
  const onPhoto = photoId !== null;
  const glyph = avatar?.kind === "emoji" ? avatar.emoji : initialsOf(name);
  const chrome = cn("absolute top-3 z-10 size-11 rounded-full backdrop-blur-sm", onPhoto ? PHOTO_CHROME : BAND_CHROME);

  const controls = (
    <>
      <Button variant="ghost" size="icon-lg" aria-label="Voltar" className={cn(chrome, "left-3")} onClick={onBack}>
        <ArrowLeft className="size-5" />
      </Button>
      {onEditPhoto && (
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Foto do grupo"
          className={cn(chrome, "right-3")}
          onClick={(event) => onEditPhoto(event.currentTarget)}
        >
          {onPhoto ? <Camera className="size-5" /> : <ImagePlus className="size-5" />}
        </Button>
      )}
    </>
  );

  if (onPhoto) {
    return (
      <section data-slot="group-hero" className="relative aspect-square max-h-[62svh] w-full overflow-hidden bg-muted md:rounded-3xl">
        <Image
          src={`/api/groups/${encodeURIComponent(groupId)}/avatar?photoId=${encodeURIComponent(photoId)}`}
          alt={name}
          fill
          unoptimized
          priority
          sizes="(min-width: 768px) 672px, 100vw"
          className="object-cover"
          onError={() => setFailedPhotoId(photoId)}
        />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
        {controls}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-4 pt-16 pb-4">
          <h1 className="line-clamp-2 text-2xl font-bold tracking-tight break-words text-white">{name}</h1>
          <p className="mt-0.5 truncate text-sm text-white/85">{meta}</p>
        </div>
      </section>
    );
  }

  return (
    <section data-slot="group-hero" className="relative isolate h-52 w-full overflow-hidden rounded-b-3xl bg-primary/10 md:rounded-3xl">
      <div aria-hidden="true" className="gradient-mesh absolute inset-0 -z-10" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 right-10 -z-10 rotate-[-8deg] text-[9rem] leading-none font-black tracking-tighter text-primary-text opacity-10 select-none"
      >
        {glyph}
      </span>
      {controls}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-4 pb-4">
        <GroupAvatar name={name} avatar={avatar} groupId={groupId} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight break-words">{name}</h1>
          <p className="mt-0.5 truncate text-sm text-foreground/75">{meta}</p>
        </div>
      </div>
    </section>
  );
}
