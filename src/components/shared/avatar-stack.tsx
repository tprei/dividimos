import { GuestAvatar } from "@/components/shared/guest-avatar";
import { UserAvatar } from "@/components/shared/user-avatar";

export interface AvatarStackPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest?: boolean;
}

export function AvatarStack({
  people,
  max = 3,
  size = "xs",
}: {
  people: AvatarStackPerson[];
  max?: number;
  size?: "xs" | "sm";
}) {
  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;
  const shownNames = shown.map((person) => person.name).join(", ");
  return (
    <div
      className="flex -space-x-2"
      aria-label={hidden > 0 ? `${shownNames}, e mais ${hidden}` : shownNames}
    >
      {shown.map((person) =>
        person.isGuest ? (
          <GuestAvatar key={person.id} size={size} className="ring-2 ring-card" />
        ) : (
          <UserAvatar
            key={person.id}
            name={person.name}
            avatarUrl={person.avatarUrl}
            size={size}
            className="ring-2 ring-card"
          />
        ),
      )}
      {hidden > 0 && (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
          +{hidden}
        </span>
      )}
    </div>
  );
}
