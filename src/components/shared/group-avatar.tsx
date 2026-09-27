"use client";

import Image from "next/image";
import { initialsOf } from "@/lib/people";
import { cn } from "@/lib/utils";
import type { GroupAvatar as GroupAvatarData } from "@/types/ledger";
import { useAvatarPhoto } from "./use-avatar-photo";

const sizeClasses = {
  sm: "size-8 text-base",
  md: "size-11 text-xl",
  lg: "size-14 text-2xl",
} as const;

const sizePixels = { sm: 32, md: 44, lg: 56 } as const;
type GroupAvatarSize = keyof typeof sizeClasses;

function GroupInitials({ name, size }: { name: string; size: GroupAvatarSize }) {
  return (
    <div role="img" aria-label={name} className={cn("flex shrink-0 items-center justify-center rounded-[28%] border border-primary/25 bg-primary/15 font-bold text-primary-text", sizeClasses[size])}>
      {initialsOf(name)}
    </div>
  );
}

function PhotoAvatar({
  name,
  groupId,
  photoId,
  size,
  eager,
}: {
  name: string;
  groupId: string;
  photoId: string;
  size: GroupAvatarSize;
  eager: boolean;
}) {
  const photoUrl = `/api/groups/${encodeURIComponent(groupId)}/avatar?photoId=${encodeURIComponent(photoId)}`;
  const { photoState, photoClassName, attachPhoto, handleLoad, handleError } = useAvatarPhoto(photoUrl);

  if (photoState === "error") return <GroupInitials name={name} size={size} />;

  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-full", sizeClasses[size])}>
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-primary/15 font-bold text-primary-text",
          photoState === "loading" && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {initialsOf(name)}
      </div>
      <Image
        src={photoUrl}
        alt={name}
        fill
        unoptimized
        loading={eager ? "eager" : undefined}
        sizes={`${sizePixels[size]}px`}
        className={photoClassName}
        ref={attachPhoto}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
}

export function GroupAvatar({
  name,
  avatar,
  groupId,
  size = "md",
  eager = false,
}: {
  name: string;
  avatar?: GroupAvatarData;
  groupId: string;
  size?: GroupAvatarSize;
  /** Header avatars are always on screen and may be a morph's source. */
  eager?: boolean;
}) {
  if (avatar?.kind === "emoji") {
    return (
      <div
        aria-label={name}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-text",
          sizeClasses[size],
        )}
        role="img"
      >
        {avatar.emoji}
      </div>
    );
  }

  if (avatar?.kind === "photo") {
    return (
      <PhotoAvatar
        key={avatar.photoId}
        name={name}
        groupId={groupId}
        photoId={avatar.photoId}
        size={size}
        eager={eager}
      />
    );
  }

  return <GroupInitials name={name} size={size} />;
}
