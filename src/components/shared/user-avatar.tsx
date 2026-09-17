"use client";

import { useState } from "react";
import Image from "next/image";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  priority?: boolean;
  isBot?: boolean;
}

const sizeClasses = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

const sizePx = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
};

const badgeClasses = {
  xs: "size-2.5",
  sm: "size-3",
  md: "size-3.5",
  lg: "size-4.5",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function UserAvatar({ name, avatarUrl, size = "md", className, priority, isBot }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const sizeClass = sizeClasses[size];
  const px = sizePx[size];

  const avatar =
    avatarUrl && !imgError ? (
      <div className={cn("relative overflow-hidden rounded-full", sizeClass, className)}>
        <Image
          src={avatarUrl}
          alt={name}
          fill
          sizes={`${px}px`}
          className="object-cover"
          priority={priority}
          onError={() => setImgError(true)}
        />
      </div>
    ) : (
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-primary/15 font-bold text-primary",
          sizeClass,
          className,
        )}
      >
        {getInitials(name)}
      </div>
    );

  if (!isBot) return avatar;

  return (
    <span className="relative inline-flex shrink-0">
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
