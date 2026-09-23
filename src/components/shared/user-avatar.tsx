"use client";

import { useState } from "react";
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

export function avatarStyle(id: string) {
  return {
    backgroundColor: `var(--avatar-tone-${avatarToneIndex(id)})`,
    color: "var(--avatar-foreground)",
  };
}

export function UserAvatar({ id, name, avatarUrl, size = "md", className, priority, isBot, standalone = false }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const sizeClass = sizeClasses[size];
  const px = sizePx[size];

  const avatar =
    avatarUrl && !imgError ? (
      <div
        className={cn("relative shrink-0 overflow-hidden rounded-full", sizeClass, className)}
        aria-hidden={standalone ? undefined : true}
      >
        <Image
          src={avatarUrl}
          alt={standalone ? name : ""}
          sizes={`${px}px`}
          className="object-cover"
          priority={priority}
          onError={() => setImgError(true)}
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
