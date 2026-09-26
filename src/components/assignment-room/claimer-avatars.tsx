import { UserAvatar } from "@/components/shared/user-avatar";
import type { AssignmentRoomClaimer } from "@/types/assignment-room";

interface ClaimerAvatarsProps {
  claimers: AssignmentRoomClaimer[];
  max?: number;
}

export function itemsWithOwnerText(ownedItemCount: number, itemCount: number): string {
  return `${ownedItemCount} de ${itemCount} ${itemCount === 1 ? "item" : "itens"} com dono`;
}

export function ClaimerAvatars({ claimers, max = 3 }: ClaimerAvatarsProps) {
  if (claimers.length === 0) return null;

  const shown = claimers.slice(0, max);
  const hidden = claimers.length - shown.length;
  const label = `Marcaram itens: ${claimers.map((claimer) => claimer.name).join(", ")}`;

  return (
    <span role="img" aria-label={label} className="flex shrink-0 -space-x-1">
      {shown.map((claimer) => (
        <UserAvatar
          key={claimer.participantId}
          id={claimer.userId ?? claimer.participantId}
          name={claimer.name}
          avatarUrl={claimer.avatarUrl}
          size="xs"
          className="ring-2 ring-card"
        />
      ))}
      {hidden > 0 && (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-foreground ring-2 ring-card">
          +{hidden}
        </span>
      )}
    </span>
  );
}
