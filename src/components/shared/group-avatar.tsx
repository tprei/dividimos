"use client";

import Image from "next/image";
import { useState } from "react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";
import type { GroupAvatar as GroupAvatarData } from "@/types/ledger";

const sizeClasses = {
  sm: "size-8 text-base",
  md: "size-11 text-xl",
  lg: "size-14 text-2xl",
} as const;

const sizePixels = { sm: 32, md: 44, lg: 56 } as const;
type GroupAvatarSize = keyof typeof sizeClasses;

function PhotoAvatar({
  name,
  groupId,
  photoId,
  size,
}: {
  name: string;
  groupId: string;
  photoId: string;
  size: GroupAvatarSize;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) return <UserAvatar name={name} size={size} />;

  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-full", sizeClasses[size])}>
      <Image
        src={`/api/groups/${encodeURIComponent(groupId)}/avatar?photoId=${encodeURIComponent(photoId)}`}
        alt={name}
        fill
        unoptimized
        sizes={`${sizePixels[size]}px`}
        className="object-cover"
        onError={() => setImageFailed(true)}
      />
    </div>
  );
}

export function GroupAvatar({
  name,
  avatar,
  groupId,
  size = "md",
}: {
  name: string;
  avatar?: GroupAvatarData;
  groupId: string;
  size?: GroupAvatarSize;
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
      />
    );
  }

  return <UserAvatar name={name} size={size} />;
}
