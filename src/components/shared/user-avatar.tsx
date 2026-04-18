"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  priority?: boolean;
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

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function UserAvatar({ name, avatarUrl, size = "md", className, priority }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const sizeClass = sizeClasses[size];
  const px = sizePx[size];

  if (avatarUrl && !imgError) {
    return (
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
    );
  }

  return (
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
}
