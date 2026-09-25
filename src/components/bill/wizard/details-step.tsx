"use client";

import type { RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { GroupSelectProps } from "@/components/bill/group-select";
import { ParticipantsStep, type ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import { DateQuestion, GroupQuestion, TitleQuestion } from "@/components/bill/wizard/start-questions";
import { StartSummary } from "@/components/bill/wizard/start-summary";
import { useBackHandler } from "@/hooks/use-back-handler";
import { haptics } from "@/hooks/use-haptics";
import { friendlyDateLabel, toIsoDate } from "@/lib/date-shortcuts";

export interface DetailsStepProps {
  title: string;
  onTitleChange: (title: string) => void;
  titleRef?: RefObject<HTMLInputElement | null>;
  occurredOn: string;
  onOccurredOnChange: (date: string) => void;
  /** Null hides the group picker (DM charges live in their conversation). */
  group: GroupSelectProps | null;
  participants: Omit<ParticipantsStepProps, "showGroupPicker">;
  /** One muted line under the people, e.g. who will be invited. */
  note?: string | null;
  /** Which question is on screen; owned by the form so its footer can wait for the people. */
  progress: StartProgress;
  onProgressChange: (progress: StartProgress) => void;
}

/** The questions of the first step, asked one at a time. */
export type StartPhase = "title" | "date" | "group" | "people";
const PHASES: readonly StartPhase[] = ["title", "date", "group", "people"];

export interface StartProgress {
  phase: StartPhase;
  /** The furthest question answered, where re-answering an earlier one returns to. */
  reached: StartPhase;
}

/** A bill that arrives named (draft, link, voice, scan) opens on the people. */
export function initialStartProgress(title: string): StartProgress {
  const phase = title.trim() ? "people" : "title";
  return { phase, reached: phase };
}

function groupLabel(group: GroupSelectProps): string {
  if (group.value === "create") return group.createValue.trim() || "Novo grupo";
  if (group.value === "dm") return "Conversa direta";
  if (group.value === null) return "Sem grupo";
  // Only real groups are listed, so an id we can't name is the DM this bill was opened from.
  return group.groups.find((snapshot) => snapshot.group.id === group.value)?.group.name ?? "Conversa direta";
}

export function DetailsStep({
  title,
  onTitleChange,
  titleRef,
  occurredOn,
  onOccurredOnChange,
  group,
  participants,
  note,
  progress,
  onProgressChange,
}: DetailsStepProps) {
  const { phase, reached } = progress;
  const reduceMotion = useReducedMotion();
  const phaseIndex = PHASES.indexOf(phase);
  const reachedIndex = PHASES.indexOf(reached);
  // A group chosen up front (group screen, chat) or no group to choose skips the question.
  const asksGroup = group !== null && group.value === null && group.groups.length > 0;

  const goTo = (next: StartPhase) => {
    onProgressChange({ phase: next, reached: PHASES.indexOf(next) > reachedIndex ? next : reached });
  };

  const advance = () => {
    haptics.tap();
    // Re-answering an earlier question returns to where the user was.
    if (phaseIndex < reachedIndex) {
      goTo(reached);
      return;
    }
    goTo(PHASES[phaseIndex + 1] === "group" && !asksGroup ? "people" : PHASES[phaseIndex + 1]);
  };

  const skipToPeople = () => {
    haptics.tap();
    goTo("people");
  };

  useBackHandler(phase === "date" || phase === "group", () => {
    goTo(phaseIndex < reachedIndex ? reached : PHASES[phaseIndex - 1]);
  });

  const count = participants.participants.length + participants.guests.length;
  const motionProps = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 } };

  return (
    <div className="space-y-4 px-4 py-3 keyboard:space-y-3 keyboard:py-2">
      {phase !== "title" && (
        <StartSummary
          title={title}
          onTitleChange={onTitleChange}
          titleRef={titleRef}
          dateLabel={reachedIndex > 1 ? friendlyDateLabel(occurredOn, toIsoDate(new Date())) : null}
          onEditDate={() => goTo("date")}
          groupLabel={group && reachedIndex > 2 ? groupLabel(group) : null}
          onEditGroup={() => goTo("group")}
        />
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={phase} {...motionProps} transition={{ duration: 0.16, ease: "easeOut" }}>
          {phase === "title" && (
            <TitleQuestion title={title} onTitleChange={onTitleChange} titleRef={titleRef} onConfirm={advance} />
          )}
          {phase === "date" && (
            <DateQuestion
              value={occurredOn}
              onPick={(iso) => {
                onOccurredOnChange(iso);
                advance();
              }}
              onSkip={skipToPeople}
            />
          )}
          {phase === "group" && group && <GroupQuestion group={group} onPick={advance} onSkip={skipToPeople} />}
          {phase === "people" && (
            <section aria-labelledby="details-people" className="space-y-1.5">
              <h2 id="details-people" className="px-1 text-xs font-semibold text-muted-foreground">
                Quem participa · {count}
              </h2>
              <ParticipantsStep {...participants} showGroupPicker={false} />
              {note && <p className="px-1 text-xs text-muted-foreground">{note}</p>}
            </section>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
