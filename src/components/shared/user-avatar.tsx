"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function UserAvatar({ name, avatarUrl, size = "md", className }: UserAvatarProps) {
  const sizeClass = sizeClasses[size];

  if (avatarUrl) {
    return (
      <div className={cn("relative overflow-hidden rounded-full", sizeClass, className)}>
        <Image src={avatarUrl} alt={name} fill className="object-cover" />
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
