"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { Money } from "@/components/shared/money";
import { Skeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";
import type { VoiceBillSketch } from "@/lib/voice-bill-sketch";

export interface VoiceBillPreviewProps {
  sketch: VoiceBillSketch;
  /** `idle` holds the ghost still; `active` means words are arriving or being read. */
  state: "idle" | "active";
}

/** Ghost ink: muted-foreground tint, so placeholders stay visible on dark cards where `bg-muted` nearly vanishes. */
const GHOST_BAR = "bg-muted-foreground/15";

function GhostAvatars({ count }: { count: number }) {
  return (
    <span className="flex -space-x-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="size-8 rounded-full border border-dashed border-muted-foreground/50 bg-muted-foreground/10 ring-2 ring-card"
        />
      ))}
    </span>
  );
}

/** `fillKey` is null while the line is still a ghost; a new key replays the fill-in. */
function Row({ label, fillKey, children, ghost }: { label: string; fillKey: string | null; children: ReactNode; ghost: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 justify-end">
        {fillKey === null ? (
          <>
            {ghost}
            <span className="sr-only">a definir</span>
          </>
        ) : (
          <motion.span
            key={fillKey}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex min-w-0 items-center justify-end gap-2"
          >
            {children}
          </motion.span>
        )}
      </dd>
    </div>
  );
}

function peopleLabel(people: string[]): string {
  if (people.length <= 2) return people.join(" e ");
  return `${people[0]} e mais ${people.length - 1}`;
}

function PeopleFill({ people }: { people: string[] }) {
  return (
    <>
      <span className="flex -space-x-2">
        {people.map((name) => (
          <UserAvatar key={name} id={name} name={name} size="sm" className="ring-2 ring-card" />
        ))}
      </span>
      <span className="truncate text-sm font-medium">{peopleLabel(people)}</span>
    </>
  );
}

/**
 * The bill voice will fill, drawn as a ticket stub. Each line starts as a
 * ghost and turns real the moment the words for it are heard, so people see
 * what to say by watching what is still blank.
 */
export function VoiceBillPreview({ sketch, state }: VoiceBillPreviewProps) {
  const skeleton = state === "active" ? "pulse" : "static";
  return (
    <section aria-label="Prévia da conta" className="overflow-hidden rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <ReceiptText className="size-3.5" aria-hidden="true" />
        Prévia da conta
      </header>
      <dl className="divide-y divide-dashed divide-border px-4">
        <Row label="O quê" fillKey={sketch.title} ghost={<Skeleton variant={skeleton} className={cn("h-4 w-28", GHOST_BAR)} />}>
          <span className="truncate text-base font-semibold">{sketch.title}</span>
        </Row>
        <Row label="Quanto" fillKey={sketch.amountCents === null ? null : String(sketch.amountCents)} ghost={<Skeleton variant={skeleton} className={cn("h-5 w-20", GHOST_BAR)} />}>
          <Money cents={sketch.amountCents ?? 0} className="text-lg font-bold" />
        </Row>
        <Row
          label="Com quem"
          fillKey={sketch.people.length > 0 ? sketch.people.join("|") : null}
          ghost={<GhostAvatars count={3} />}
        >
          <PeopleFill people={sketch.people} />
        </Row>
      </dl>
    </section>
  );
}

const VOICE_EXAMPLES = ["Uber com João, 25 reais", "Pizza 80 com Ana e Bia", "Mercado 120 e cinquenta"] as const;

export function VoiceExamples() {
  return (
    <section aria-labelledby="voice-examples-heading" className="px-1">
      <h2 id="voice-examples-heading" className="text-xs font-medium text-muted-foreground">Dá pra falar assim</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {VOICE_EXAMPLES.map((phrase) => (
          <li key={phrase} className="rounded-full border border-border bg-card/70 px-3 py-1.5 text-sm text-foreground">
            “{phrase}”
          </li>
        ))}
      </ul>
    </section>
  );
}
