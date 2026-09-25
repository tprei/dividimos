"use client";

import type { RefObject } from "react";
import { GroupSelect, type GroupSelectProps } from "@/components/bill/group-select";
import { ParticipantsStep, type ParticipantsStepProps } from "@/components/bill/wizard/participants-step";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";

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
}: DetailsStepProps) {
  const count = participants.participants.length + participants.guests.length;
  return (
    <div className="space-y-4 px-4 py-3">
      <div className="space-y-1.5">
        <label htmlFor="expense-title" className="px-1 text-xs font-semibold text-muted-foreground">
          Nome da conta
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="expense-title"
            ref={titleRef}
            placeholder="Ex.: Pizza de sexta"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            className="min-w-0 flex-1"
          />
          <DateField label="Data" variant="subtle" value={occurredOn} onChange={onOccurredOnChange} />
        </div>
      </div>
      {group && (
        <div className="space-y-1.5">
          <p className="px-1 text-xs font-semibold text-muted-foreground">Grupo</p>
          <GroupSelect {...group} />
        </div>
      )}
      <section aria-labelledby="details-people" className="space-y-1.5">
        <h2 id="details-people" className="px-1 text-xs font-semibold text-muted-foreground">
          Quem participa · {count}
        </h2>
        <ParticipantsStep {...participants} showGroupPicker={false} />
        {note && <p className="px-1 text-xs text-muted-foreground">{note}</p>}
      </section>
    </div>
  );
}
