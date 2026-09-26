"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { UserAvatar } from "@/components/shared/user-avatar";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";

export interface RingArc {
  startDegrees: number;
  sweepDegrees: number;
}

interface PersonBase {
  id: string;
  /** Accessible name; the visible avatar only shows initials or a photo. */
  label: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  selected: boolean;
  /** This person's slice of the row's shared pie; a selected person without one gets the whole ring. */
  arc?: RingArc;
}

export interface PersonToggleProps extends PersonBase {
  onToggle: () => void;
}

export interface PersonShareButtonProps extends PersonBase {
  onOpen: () => void;
}

const RING_BOX = 40;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_BOX - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const FULL_RING: RingArc = { startDegrees: 0, sweepDegrees: 360 };

function ShareRing({ selected, arc }: { selected: boolean; arc: RingArc }) {
  const circle = { cx: RING_BOX / 2, cy: RING_BOX / 2, r: RING_RADIUS, fill: "none", strokeWidth: RING_STROKE };
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}
      className="pointer-events-none absolute inset-0 size-full -rotate-90"
    >
      <circle
        {...circle}
        strokeWidth={selected ? RING_STROKE : 1.25}
        strokeDasharray={selected ? undefined : "3 3"}
        className={selected ? "stroke-primary/20" : "stroke-muted-foreground/45"}
      />
      <circle
        {...circle}
        style={{
          strokeDasharray: `${(arc.sweepDegrees / 360) * RING_LENGTH} ${RING_LENGTH}`,
          strokeDashoffset: -(arc.startDegrees / 360) * RING_LENGTH,
        }}
        className="stroke-primary transition-[stroke-dasharray,stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}

function PersonRingButton({
  id,
  label,
  name,
  avatarUrl,
  isGuest,
  selected,
  arc,
  pressed,
  onClick,
}: PersonBase & { pressed?: boolean; onClick: () => void }) {
  const tone = cn("size-8 transition-[opacity,filter]", !selected && "opacity-40 grayscale");
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={name}
      onClick={onClick}
      className="relative flex size-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 after:absolute after:-inset-0.5"
    >
      <ShareRing
        selected={selected}
        arc={selected ? (arc ?? FULL_RING) : { startDegrees: arc?.startDegrees ?? 0, sweepDegrees: 0 }}
      />
      {isGuest ? (
        <GuestAvatar id={id} name={name} size="sm" className={tone} />
      ) : (
        <UserAvatar id={id} name={name} avatarUrl={avatarUrl} size="sm" className={tone} />
      )}
    </button>
  );
}

/** Tapping adds or removes the person: the row stays an equal split. */
export function PersonToggle({ onToggle, ...person }: PersonToggleProps) {
  return (
    <PersonRingButton
      {...person}
      pressed={person.selected}
      onClick={() => {
        haptics.selectionChanged();
        onToggle();
      }}
    />
  );
}

/** Shows a custom share; tapping opens the editor instead of toggling. */
export function PersonShareButton({ onOpen, ...person }: PersonShareButtonProps) {
  return <PersonRingButton {...person} onClick={onOpen} />;
}
