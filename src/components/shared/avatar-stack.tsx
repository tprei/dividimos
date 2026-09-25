import { GuestAvatar } from "@/components/shared/guest-avatar";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";

export interface AvatarStackPerson {
  id: string;
  name: string;
  handle?: string | null;
  avatarUrl: string | null;
  isGuest?: boolean;
}

export function AvatarStack({
  people,
  max = 3,
  size = "xs",
  surface = "card",
}: {
  people: AvatarStackPerson[];
  max?: number;
  size?: "xs" | "sm";
  surface?: "card" | "background" | "muted";
}) {
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;
  const shownNames = shown.map((person) => person.name).join(", ");
  const ring = cn("ring-2", {
    "ring-card": surface === "card",
    "ring-background": surface === "background",
    "ring-muted": surface === "muted",
  });
  return (
    <div
      className="flex -space-x-1"
      aria-label={hidden > 0 ? `${shownNames}, e mais ${hidden}` : shownNames}
    >
      {shown.map((person) =>
        person.isGuest ? (
          <GuestAvatar key={person.id} id={person.id} name={person.name} size={size} className={ring} />
        ) : (
          <UserAvatar
            key={person.id}
            id={person.id}
            name={person.name}
            avatarUrl={person.avatarUrl}
            size={size}
            className={ring}
          />
        ),
      )}
      {hidden > 0 && (
        <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-foreground", size === "xs" ? "size-6" : "size-8", ring)}>
          +{hidden}
        </span>
      )}
    </div>
  );
}
