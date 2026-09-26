"use client";

import { motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ArrowLeft, Camera, ImagePlus } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { usePullProgress } from "@/components/group/group-pull-reveal";
import { GroupAvatar } from "@/components/shared/group-avatar";
import { Button } from "@/components/ui/button";
import { springs } from "@/lib/animations";
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

/** Shared-layout id tying the 32px header avatar to this hero. */
export const groupHeroLayoutId = (groupId: string) => `group-hero-${groupId}`;

const PHOTO_CHROME = "bg-black/35 text-white hover:bg-black/50 hover:text-white";
const BAND_CHROME = "border border-border bg-card/80 text-foreground hover:bg-card";

const chromeVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.16, delay: 0.1 } },
};

const bandVariants = {
  hidden: { opacity: 0, scaleY: 0.72 },
  visible: { opacity: 1, scaleY: 1, transition: springs.reveal },
};

const bandReducedVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
};

/**
 * The group's header: a full-bleed photo with the name laid over it, or,
 * without a photo, a warm band carrying the emoji/initials large. Both keep
 * the same corners: back top-left, photo editor top-right, identity at the
 * bottom. The header avatar morphs into the photo (or the in-band avatar)
 * through the shared `groupHeroLayoutId`; a grabber at the top hints that a
 * pull goes back, and the pull itself stretches and dims the hero.
 */
export function GroupHero({ groupId, name, avatar, meta, onBack, onEditPhoto }: GroupHeroProps) {
  const [failedPhotoId, setFailedPhotoId] = useState<string | null>(null);
  const reduced = useReducedMotion() ?? false;
  const photoId = avatar?.kind === "photo" && avatar.photoId !== failedPhotoId ? avatar.photoId : null;
  const onPhoto = photoId !== null;
  const glyph = avatar?.kind === "emoji" ? avatar.emoji : initialsOf(name);
  const chrome = cn("absolute top-3 z-10 size-11 rounded-full backdrop-blur-sm", onPhoto ? PHOTO_CHROME : BAND_CHROME);
  const morphId = reduced ? undefined : groupHeroLayoutId(groupId);

  const pull = usePullProgress();
  const resting = useMotionValue(0);
  const progress = pull ?? resting;
  const pullActive = pull !== null && !reduced;
  const stretch = useTransform(progress, (value) => 1 + Math.min(value, 1.2) * 0.06);
  const dim = useTransform(progress, (value) => Math.min(value, 1.2) * (onPhoto ? 0.22 : 0.08));

  const controls = (
    <motion.div variants={chromeVariants}>
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
    </motion.div>
  );

  const grabber = (
    <div aria-hidden="true" className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2">
      <span className={cn("block h-1 w-9 rounded-full", onPhoto ? "bg-white/60" : "bg-foreground/20")} />
    </div>
  );

  const dimOverlay = pullActive ? (
    <motion.div aria-hidden="true" style={{ opacity: dim }} className={cn("absolute inset-0", onPhoto ? "bg-black" : "bg-foreground")} />
  ) : null;

  if (onPhoto) {
    return (
      <motion.section
        data-slot="group-hero"
        layoutId={morphId}
        transition={springs.reveal}
        className="relative aspect-square max-h-[62svh] w-full overflow-hidden bg-muted md:rounded-3xl"
      >
        <motion.div
          aria-hidden="true"
          style={pullActive ? { scaleY: stretch, transformOrigin: "50% 0%" } : undefined}
          className="absolute inset-0"
        >
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
        </motion.div>
        {dimOverlay}
        <motion.div aria-hidden="true" variants={chromeVariants} className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent" />
        {grabber}
        {controls}
        <motion.div variants={chromeVariants} className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-4 pt-16 pb-4">
          <h1 className="line-clamp-2 text-2xl font-bold tracking-tight break-words text-white">{name}</h1>
          <p className="mt-0.5 truncate text-sm text-white/85">{meta}</p>
        </motion.div>
      </motion.section>
    );
  }

  return (
    <motion.section
      data-slot="group-hero"
      variants={reduced ? bandReducedVariants : bandVariants}
      style={{ transformOrigin: "50% 0%" }}
      className="relative isolate h-52 w-full overflow-hidden rounded-b-3xl bg-primary/10 md:rounded-3xl"
    >
      <motion.div
        aria-hidden="true"
        style={pullActive ? { scaleY: stretch, transformOrigin: "50% 0%" } : undefined}
        className="absolute inset-0 -z-10"
      >
        <div className="gradient-mesh absolute inset-0" />
        <span className="pointer-events-none absolute -top-6 right-10 rotate-[-8deg] text-[9rem] leading-none font-black tracking-tighter text-primary-text opacity-10 select-none">
          {glyph}
        </span>
      </motion.div>
      {dimOverlay}
      {grabber}
      {controls}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-4 pb-4">
        <motion.div layoutId={morphId} transition={springs.reveal}>
          <GroupAvatar name={name} avatar={avatar} groupId={groupId} size="lg" />
        </motion.div>
        <motion.div variants={chromeVariants} className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-2xl leading-tight font-bold tracking-tight break-words">{name}</h1>
          <p className="mt-0.5 truncate text-sm text-foreground/75">{meta}</p>
        </motion.div>
      </div>
    </motion.section>
  );
}
