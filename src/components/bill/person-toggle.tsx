"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { UserAvatar } from "@/components/shared/user-avatar";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";

export interface PersonToggleProps {
  id: string;
  label: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  selected: boolean;
  onToggle: () => void;
}

export function PersonToggle({ id, label, name, avatarUrl, isGuest, selected, onToggle }: PersonToggleProps) {
  const tone = cn(
    "transition-[opacity,filter,box-shadow]",
    selected ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "opacity-40 grayscale",
  );
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={name}
      onClick={() => {
        haptics.selectionChanged();
        onToggle();
      }}
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-1.5",
        !selected && "outline-1 outline-offset-1 outline-border outline-dashed",
      )}
    >
      {isGuest ? (
        <GuestAvatar id={id} name={name} size="sm" className={tone} />
      ) : (
        <UserAvatar id={id} name={name} avatarUrl={avatarUrl} size="sm" className={tone} />
      )}
    </button>
  );
}
