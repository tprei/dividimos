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
  /** True while the account's groups are still loading, so the group question is kept instead of skipped. */
  groupsPending?: boolean;
}

/** The questions of the first step, asked one at a time. */
export type StartPhase = "title" | "date" | "group" | "people";
const PHASES: readonly StartPhase[] = ["title", "date", "group", "people"];

export interface StartProgress {
  phase: StartPhase;
  /** The furthest question answered, where re-answering an earlier one returns to. */
  reached: StartPhase;
  /** The last question actually answered; skipped ones don't count. Back from the people returns here. */
  lastAnswered: StartPhase;
}

/** A bill that arrives named (draft, link, voice, scan) opens on the people. */
export function initialStartProgress(title: string): StartProgress {
  const phase = title.trim() ? "people" : "title";
  return { phase, reached: phase, lastAnswered: phase };
}

function groupLabel(group: GroupSelectProps): string {
  if (group.value === "create") {
    return group.createValue.trim() || group.createFallback?.trim() || "Novo grupo";
  }
  if (group.value === "dm") return "Conversa direta";
  // With one other account holder and no group picked, the submit puts the bill in the DM.
  if (group.value === null) return group.dmEligible ? "Conversa direta" : "Sem grupo";
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
  groupsPending = false,
}: DetailsStepProps) {
  const { phase, reached, lastAnswered } = progress;
  const reduceMotion = useReducedMotion();
  const phaseIndex = PHASES.indexOf(phase);
  const reachedIndex = PHASES.indexOf(reached);
  // A group chosen up front (group screen, chat) or no group to choose skips the question.
  // While the group list is still loading it is not yet known to be empty, so keep the question.
  const asksGroup =
    group !== null && group.value === null && (group.groups.length > 0 || groupsPending);

  const goTo = (next: StartPhase, answered: boolean) => {
    onProgressChange({
      phase: next,
      reached: PHASES.indexOf(next) > reachedIndex ? next : reached,
      lastAnswered: answered ? phase : lastAnswered,
    });
  };

  const advance = () => {
    haptics.tap();
    // Re-answering an earlier question returns to where the user was.
    if (phaseIndex < reachedIndex) {
      goTo(reached, true);
      return;
    }
    goTo(PHASES[phaseIndex + 1] === "group" && !asksGroup ? "people" : PHASES[phaseIndex + 1], true);
  };

  const skipToPeople = () => {
    haptics.tap();
    goTo("people", false);
  };

  // Hardware back walks back through the questions that were actually asked
  // (skipped ones don't reopen) and only then falls through to the form.
  let backTarget: StartPhase | null = null;
  if (phase === "people") {
    backTarget = lastAnswered !== "people" ? lastAnswered : null;
  } else if (phaseIndex > 0) {
    backTarget = PHASES[phaseIndex - 1];
  }
  useBackHandler(backTarget !== null, () => {
    if (backTarget) goTo(backTarget, false);
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
          onEditDate={() => goTo("date", false)}
          groupLabel={group && reachedIndex > 2 ? groupLabel(group) : null}
          onEditGroup={() => goTo("group", false)}
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
          {phase === "group" && group && (
            <GroupQuestion group={group} groupsPending={groupsPending} onPick={advance} onSkip={skipToPeople} />
          )}
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
