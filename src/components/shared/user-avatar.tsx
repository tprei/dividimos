"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarToneIndex, initialsOf } from "@/lib/people";

interface UserAvatarProps {
  id?: string;
  name: string;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  priority?: boolean;
  isBot?: boolean;
  standalone?: boolean;
}

const sizeClasses = {
  xs: "h-6 w-6 text-xs",
  sm: "h-8 w-8 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-lg",
};

const sizePx = {
  xs: 24,
  sm: 32,
  md: 44,
  lg: 56,
};

// Suppressed for size="xs": at 24px, a 10px badge leaves an unreadable ~6px glyph.
const badgeClasses: Record<"sm" | "md" | "lg", string> = {
  sm: "size-3",
  md: "size-3.5",
  lg: "size-4.5",
};

type PhotoState = "loading" | "loaded" | "error";

export function avatarStyle(id: string) {
  return {
    backgroundColor: `var(--avatar-tone-${avatarToneIndex(id)})`,
    color: "var(--avatar-foreground)",
  };
}

export function UserAvatar({ id, name, avatarUrl, size = "md", className, priority, isBot, standalone = false }: UserAvatarProps) {
  const [photoState, setPhotoState] = useState<PhotoState>("loading");
  const [prevUrl, setPrevUrl] = useState(avatarUrl);
  // Adjusting state during render: a new URL restarts the cycle instead of
  // staying stuck on the previous photo's "loaded"/"error" state.
  if (prevUrl !== avatarUrl) {
    setPrevUrl(avatarUrl);
    setPhotoState("loading");
  }
  // A cached photo can already be decoded by the time React attaches: start
  // loaded so it paints instantly instead of pulsing behind opacity-0 until
  // onLoad's state update round-trips through hydration.
  const attachPhoto = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) {
      setPhotoState("loaded");
    }
  }, []);
  const sizeClass = sizeClasses[size];
  const px = sizePx[size];

  const photoUrl = avatarUrl && photoState !== "error" ? avatarUrl : undefined;

  const toneLayer = (
    <div
      aria-hidden="true"
      style={avatarStyle(id ?? name)}
      className={cn(
        "absolute inset-0 flex items-center justify-center rounded-full font-bold",
        photoState === "loading" && "animate-pulse motion-reduce:animate-none",
      )}
    >
      {initialsOf(name)}
    </div>
  );

  const avatar =
    photoUrl ? (
      <div
        className={cn("relative shrink-0 overflow-hidden rounded-full", sizeClass, className)}
        aria-hidden={standalone ? undefined : true}
      >
        {toneLayer}
        {/* fill is load-bearing: without it (and without width/height) Next
            emits an <img> at intrinsic size, which collapses inside the box. */}
        <Image
          src={photoUrl}
          fill
          alt={standalone ? name : ""}
          sizes={`${px}px`}
          priority={priority}
          ref={attachPhoto}
          onLoad={() => setPhotoState("loaded")}
          onError={() => setPhotoState("error")}
          className={cn(
            "object-cover opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
            photoState === "loaded" && "opacity-100",
          )}
        />
      </div>
    ) : (
      <div
        role={standalone ? "img" : undefined}
        aria-label={standalone ? name : undefined}
        aria-hidden={standalone ? undefined : true}
        style={avatarStyle(id ?? name)}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-bold",
          sizeClass,
          className,
        )}
      >
        {initialsOf(name)}
      </div>
    );

  if (!isBot || size === "xs") return avatar;

  return (
    <span className="relative flex shrink-0">
      {avatar}
      <Bot
        role="img"
        aria-label="Bot verificado"
        className={cn(
          "absolute -right-0.5 -bottom-0.5 rounded-full bg-primary p-0.5 text-primary-foreground",
          badgeClasses[size],
        )}
      />
    </span>
  );
}
