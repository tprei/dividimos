"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";

import type { GroupPlan } from "@/components/bill/single-bill/use-group-resolution";
import { SingleBillDetails } from "@/components/bill/single-bill/details-section";
import {
  initialFixedTexts,
  initialMode,
  initialPercentTexts,
} from "@/components/bill/single-bill/division-state";
import { SingleBillDivision } from "@/components/bill/single-bill/division-section";
import { SingleBillPayerSection } from "@/components/bill/single-bill/payer-section";
import { SingleBillStageTabs, type SingleBillStage } from "@/components/bill/single-bill/stage-tabs";
import {
  profileToUser,
  useGroupResolution,
} from "@/components/bill/single-bill/use-group-resolution";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import { useBackHandler } from "@/hooks/use-back-handler";
import type { ItemDivisionMode } from "@/lib/item-division";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";

export interface SingleBillFormProps {
  me: Me;
  groups: GroupSnapshot[];
  initialGroupId: string | null;
  isDmMode: boolean;
  isEditing: boolean;
  hasContactPicker: boolean;
  onPickContacts: () => Promise<void>;
  onBack: () => void;
  submit: (planGroup: () => Promise<GroupPlan>) => Promise<boolean>;
  submitting: boolean;
}

export function SingleBillForm({
  me,
  groups,
  initialGroupId,
  isDmMode,
  isEditing,
  hasContactPicker,
  onPickContacts,
  onBack,
  submit,
  submitting,
}: SingleBillFormProps) {
  const store = useBillStore(
    useShallow((state) => ({
      expense: state.expense,
      totalAmountInput: state.totalAmountInput,
      occurredOn: state.occurredOn,
      participants: state.participants,
      guests: state.guests,
      payers: state.payers,
      updateExpense: state.updateExpense,
      setOccurredOn: state.setOccurredOn,
      addParticipant: state.addParticipant,
      removeParticipant: state.removeParticipant,
      addGuest: state.addGuest,
      removeGuest: state.removeGuest,
      billSplits: state.billSplits,
      setPayerFull: state.setPayerFull,
      splitBillEqually: state.splitBillEqually,
      splitBillByBasisPoints: state.splitBillByBasisPoints,
      splitBillByFixed: state.splitBillByFixed,
    })),
  );
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [stage, setStage] = useState<SingleBillStage>("conta");
  const [divisionValid, setDivisionValid] = useState(false);
  const [mode, setMode] = useState<ItemDivisionMode>(() => initialMode(store.billSplits));
  const [percentTexts, setPercentTexts] = useState<Record<string, string>>(() =>
    initialPercentTexts(store.billSplits),
  );
  const [fixedTexts, setFixedTexts] = useState<Record<string, string>>(() =>
    initialFixedTexts(store.billSplits),
  );
  const {
    groupSelection,
    createGroupName,
    createGroupEnabled,
    setCreateGroupName,
    setCreateGroupEnabled,
    handleGroupSelect,
    planGroup,
  } = useGroupResolution({ me, groups, initialGroupId, isDmMode });

  const allPeople = useMemo(
    () => [...store.participants, ...store.guests],
    [store.guests, store.participants],
  );
  const otherParticipants = useMemo(
    () => store.participants.filter((participant) => participant.id !== me.id),
    [me.id, store.participants],
  );
  const defaultGroupName = useMemo(() => {
    const names = allPeople.map((person) => person.name.split(" ")[0]);
    if (names.length === 0) return "";
    return names.length <= 3 ? names.join(" e ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
  }, [allPeople]);
  const dmEligible = otherParticipants.length === 1 && store.guests.length === 0;
  const payerTotal = store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  const hasPayer = store.payers.length > 0 && payerTotal === (store.totalAmountInput || 0);
  const totalCents = store.totalAmountInput || 0;
  const participantCount = allPeople.length;
  const title = store.expense?.title ?? "";
  const contaValid = totalCents > 0 && Boolean(title.trim()) && participantCount >= 2;
  const canSubmit = Boolean(
    store.expense &&
      title.trim() &&
      totalCents > 0 &&
      participantCount >= 2 &&
      divisionValid &&
      hasPayer,
  );

  useBackHandler(stage === "divisao", () => setStage("conta"));

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    await submit(() => planGroup(defaultGroupName));
  }, [canSubmit, defaultGroupName, planGroup, submit]);

  return (
    <div className="mx-auto max-w-lg">
      <ScreenHeader
        back
        onBack={onBack}
        eyebrow="Valor único"
        title={isEditing ? "Editar conta" : "Nova conta"}
      />
      <SingleBillStageTabs stage={stage} divisaoEnabled={contaValid} onSelect={setStage} />
      {stage === "conta" ? (
        <SingleBillDetails
          me={me}
          groups={groups}
          totalCents={totalCents}
          title={title}
          occurredOn={store.occurredOn ?? todayIsoDate()}
          groupSelection={groupSelection}
          createGroupName={createGroupName}
          createGroupEnabled={createGroupEnabled}
          defaultGroupName={defaultGroupName}
          dmEligible={dmEligible}
          participants={store.participants}
          guests={store.guests}
          participantCount={participantCount}
          participantsOpen={participantsOpen}
          hasContactPicker={hasContactPicker}
          onTotalChange={(cents) => store.updateExpense({ totalAmountInput: cents, totalAmount: cents })}
          onTitleChange={(nextTitle) => store.updateExpense({ title: nextTitle })}
          onOccurredOnChange={store.setOccurredOn}
          onGroupSelect={handleGroupSelect}
          onCreateGroupNameChange={setCreateGroupName}
          onToggleCreateGroup={setCreateGroupEnabled}
          onParticipantsOpenChange={setParticipantsOpen}
          onAddParticipant={(profile) => store.addParticipant(profileToUser(profile))}
          onRemoveParticipant={store.removeParticipant}
          onAddGuest={store.addGuest}
          onRemoveGuest={store.removeGuest}
          onPickContacts={onPickContacts}
        />
      ) : (
        <div className="space-y-5 px-4 pb-4">
          <SingleBillPayerSection
            participants={store.participants}
            payers={store.payers}
            hasPayer={hasPayer}
            onPayerSelect={store.setPayerFull}
          />
          <SingleBillDivision
            totalCents={totalCents}
            participants={store.participants}
            guests={store.guests}
            splitBillEqually={store.splitBillEqually}
            splitBillByBasisPoints={store.splitBillByBasisPoints}
            splitBillByFixed={store.splitBillByFixed}
            onValidityChange={setDivisionValid}
            mode={mode}
            onModeChange={setMode}
            percentTexts={percentTexts}
            onPercentTextChange={(userId, value) =>
              setPercentTexts((current) => ({ ...current, [userId]: value }))
            }
            fixedTexts={fixedTexts}
            onFixedTextChange={(userId, value) =>
              setFixedTexts((current) => ({ ...current, [userId]: value }))
            }
          />
        </div>
      )}
      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur safe-bottom">
        {stage === "conta" ? (
          <Button
            type="button"
            size="lg"
            className="h-12 w-full text-base font-bold"
            disabled={!contaValid}
            onClick={() => setStage("divisao")}
          >
            Continuar
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="h-12 w-full text-base font-bold"
            disabled={!canSubmit || submitting}
            onClick={() => void handleSubmit()}
            aria-describedby="single-bill-division-status"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {isEditing ? "Salvando…" : "Criando…"}
              </>
            ) : isEditing ? (
              "Salvar"
            ) : (
              "Criar conta"
            )}
          </Button>
        )}
      </footer>
    </div>
  );
}
