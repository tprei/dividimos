import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";

export interface RailPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
}

export type ChatRailMarker =
  | { kind: "expense" | "system" | "message" }
  | { kind: "payment" }
  | { kind: "people"; people: RailPerson[] };

export function formatChatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DOT_CLASSES = {
  expense: "top-3.5 size-2 bg-primary",
  system: "top-1.25 size-1.5 bg-muted-foreground/60",
  message: "top-3.5 size-1.5 bg-muted-foreground/35",
} as const;

function RailAvatar({
  person,
  position,
  ring,
  onOpen,
}: {
  person: RailPerson;
  position: string;
  ring: string;
  onOpen?: (userId: string) => void;
}) {
  if (!onOpen) {
    return (
      <span aria-hidden="true" className={position}>
        <UserAvatar
          id={person.id}
          name={person.name}
          avatarUrl={person.avatarUrl}
          isBot={person.isBot}
          size="xs"
          className={ring}
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Ver perfil de ${person.name}`}
      onClick={() => {
        haptics.tap();
        onOpen(person.id);
      }}
      className={cn(
        position,
        "flex size-6 rounded-full after:absolute after:-inset-2.5 after:rounded-full focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring motion-safe:transition-transform motion-safe:active:scale-[0.92]",
      )}
    >
      <UserAvatar
        id={person.id}
        name={person.name}
        avatarUrl={person.avatarUrl}
        isBot={person.isBot}
        size="xs"
        className={ring}
      />
    </button>
  );
}

interface PersonTap {
  /** Makes rail avatars open that person's profile; never offered for `meId`. */
  onOpenPerson?: (userId: string) => void;
  meId?: string;
}

function PeopleStack({ people, onOpenPerson, meId }: { people: RailPerson[] } & PersonTap) {
  const [front, behind] = people;
  const hiddenCount = people.length - (behind ? 2 : 1);
  return (
    <>
      {behind && (
        <RailAvatar
          person={behind}
          position="absolute top-0.5 -left-2.5 z-10"
          ring="text-[0px] ring-2 ring-background"
        />
      )}
      <RailAvatar
        person={front}
        position="absolute top-0.5 left-0 z-20"
        ring="ring-3 ring-background"
        onOpen={front.id !== meId ? onOpenPerson : undefined}
      />
      {hiddenCount > 0 && (
        <span aria-hidden="true" className="pointer-events-none absolute top-4 -right-2 z-30 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-2xs font-semibold leading-none tabular-nums text-foreground ring-2 ring-background">
          +{hiddenCount}
        </span>
      )}
    </>
  );
}

function MarkerGraphic({ marker, onOpenPerson, meId }: { marker: ChatRailMarker } & PersonTap) {
  if (marker.kind === "payment") {
    return (
      <span className="absolute top-2.5 left-1/2 flex size-4 -translate-x-1/2 items-center justify-center rounded-full bg-success text-success-foreground ring-3 ring-background">
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (marker.kind === "people") {
    return <PeopleStack people={marker.people} onOpenPerson={onOpenPerson} meId={meId} />;
  }
  return (
    <span
      className={cn(
        "absolute left-1/2 -translate-x-1/2 rounded-full ring-3 ring-background",
        DOT_CLASSES[marker.kind],
      )}
    />
  );
}

interface ChatRailRowProps extends PersonTap {
  marker: ChatRailMarker;
  spaced?: boolean;
  children: ReactNode;
}

export function ChatRailRow({ marker, spaced = false, onOpenPerson, meId, children }: ChatRailRowProps) {
  return (
    <div
      className={cn(
        "relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2.5 before:absolute before:inset-y-0 before:left-3 before:w-px before:-translate-x-1/2 before:bg-border",
        spaced && "pt-2.5",
      )}
    >
      <div className="relative">
        <MarkerGraphic marker={marker} onOpenPerson={onOpenPerson} meId={meId} />
      </div>
      <div className="min-w-0 pb-1.5">{children}</div>
    </div>
  );
}
