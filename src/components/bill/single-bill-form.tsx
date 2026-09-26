"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { todayIsoDate } from "@/app/app/bill/new/use-wizard-submit";
import { AmountQuickAdd } from "@/components/bill/amount-quick-add";
import { GUEST_PAYER_NOTICE } from "@/components/bill/payer-copy";
import { AmountField } from "@/components/bill/single-bill/amount-field";
import { consumptionSeed } from "@/components/bill/single-bill/division-state";
import type { GroupPlan } from "@/components/bill/single-bill/use-group-resolution";
import {
  profileToUser,
  useGroupResolution,
} from "@/components/bill/single-bill/use-group-resolution";
import { SplitEditor, type SplitPerson } from "@/components/bill/split/split-editor";
import { SplitSummary } from "@/components/bill/split/split-summary";
import { usePayerSplit } from "@/components/bill/split/use-payer-split";
import { useSplitDraft } from "@/components/bill/split/use-split-draft";
import { DetailsStep, initialStartProgress } from "@/components/bill/wizard/details-step";
import { WizardFooter } from "@/components/bill/wizard/wizard-footer";
import { WizardSteps } from "@/components/bill/wizard/wizard-steps";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
import { ScrollHint } from "@/components/shared/scroll-hint";
import { Button } from "@/components/ui/button";
import { useBackHandler } from "@/hooks/use-back-handler";
import { defaultGroupName, displayNames } from "@/lib/people";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useShallow } from "zustand/react/shallow";

const STEPS = ["Participantes", "Valor e divisão", "Quem pagou"] as const;

export interface SingleBillFormProps {
  me: Me;
  groups: GroupSnapshot[];
  initialGroupId: string | null;
  isDmMode: boolean;
  isEditing: boolean;
  hasContactPicker: boolean;
  onPickContacts: () => Promise<void>;
  /** Leaves the wizard; the page asks first when there is unsaved input. */
  onBack: () => void;
  submit: (planGroup: () => Promise<GroupPlan>) => Promise<boolean>;
  submitting: boolean;
  conflictPanel?: ReactNode;
  submitBlockedReason?: string | null;
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
  conflictPanel,
  submitBlockedReason,
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
      setPayerFull: state.setPayerFull,
      splitPaymentEqually: state.splitPaymentEqually,
      setPayerAmount: state.setPayerAmount,
      removePayerEntry: state.removePayerEntry,
      splitBillEqually: state.splitBillEqually,
      splitBillByBasisPoints: state.splitBillByBasisPoints,
      splitBillByFixed: state.splitBillByFixed,
    })),
  );
  const [step, setStep] = useState(0);
  const [startProgress, setStartProgress] = useState(() =>
    initialStartProgress(useBillStore.getState().expense?.title ?? ""),
  );
  const [amountValid, setAmountValid] = useState(true);
  const {
    groupSelection,
    createGroupName,
    createGroupEnabled,
    setCreateGroupName,
    setCreateGroupEnabled,
    handleGroupSelect,
    planGroup,
  } = useGroupResolution({ me, groups, initialGroupId, isDmMode });

  const totalCents = store.totalAmountInput || 0;
  const title = store.expense?.title ?? "";
  const groupsPending = useAppStore((s) => s.bootstrapStatus === "idle" || s.bootstrapStatus === "loading");
  const people = useMemo(
    () => [
      ...store.participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        handle: participant.handle,
        avatarUrl: participant.avatarUrl ?? null,
        isGuest: false,
      })),
      ...store.guests.map((guest) => ({
        id: guest.id,
        name: guest.name,
        handle: null,
        avatarUrl: null,
        isGuest: true,
      })),
    ],
    [store.guests, store.participants],
  );
  const peopleIds = useMemo(() => people.map((person) => person.id), [people]);
  const participantIds = useMemo(
    () => store.participants.map((participant) => participant.id),
    [store.participants],
  );
  const labels = displayNames(people, { style: "short", viewerId: me.id });
  const splitPeople: SplitPerson[] = people.map((person) => ({
    id: person.id,
    label: labels.get(person.id) ?? person.name,
    name: person.name,
    avatarUrl: person.avatarUrl,
    isGuest: person.isGuest,
  }));

  const consumption = useSplitDraft({
    peopleIds,
    totalCents,
    includeNewcomers: true,
    seed: () => consumptionSeed(useBillStore.getState().billSplits, peopleIds),
  });
  const consumed = consumption.draft;
  const consumedCents = consumption.centsById;
  const { splitBillEqually, splitBillByBasisPoints, splitBillByFixed } = store;
  useEffect(() => {
    if (totalCents <= 0 || consumed.included.length === 0) return;
    if (consumed.mode === "equal") {
      splitBillEqually([...consumed.included]);
    } else if (consumed.mode === "percent") {
      splitBillByBasisPoints(
        consumed.included.map((userId) => ({ userId, basisPoints: consumed.percent.shares[userId] })),
      );
    } else {
      splitBillByFixed(
        consumed.included.map((userId) => ({ userId, amountCents: consumed.fixed.shares[userId] })),
      );
    }
  }, [consumed, splitBillByBasisPoints, splitBillByFixed, splitBillEqually, totalCents]);

  const payers = usePayerSplit({
    participantIds,
    totalCents,
    initialPayers: () => useBillStore.getState().payers,
    fallbackId: me.id,
    actions: store,
  });

  const participantCount = people.length;
  const others = store.participants.filter((participant) => participant.id !== me.id);
  const dmEligible = others.length === 1 && store.guests.length === 0;
  const defaultGroupLabel = defaultGroupName(people.map((person) => person.name));
  // Before other people exist the default would just be the user's own name,
  // which is not what the group will be called once the bill is submitted.
  const createGroupFallback = participantCount > 1 ? defaultGroupLabel : "";
  const selectedGroup = groups.find((snapshot) => snapshot.group.id === groupSelection) ?? null;
  const inviteeNames = selectedGroup
    ? others
        .filter((participant) => !selectedGroup.members.some((member) => member.userId === participant.id))
        .map((participant) => labels.get(participant.id))
    : [];
  const paidTotal = store.payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  const hasPayer = store.payers.length > 0 && paidTotal === totalCents;

  const stepBlocker = [
    !title.trim()
      ? "Falta o nome da conta."
      : participantCount < 2
        ? "Falta alguém pra dividir com você."
        : null,
    !amountValid
      ? "O valor da conta está inválido."
      : totalCents <= 0
        ? "Falta o valor da conta."
        : consumed.included.length === 0
          ? "Escolha quem consumiu."
          : null,
    submitBlockedReason ??
      (payers.draft.included.length === 0
        ? "Escolha quem pagou."
        : !hasPayer
          ? "O que foi pago não bate com o total."
          : null),
  ];
  const firstBlockedStep = stepBlocker.findIndex((reason) => reason !== null);
  const blocker = stepBlocker.slice(0, step + 1).find((reason) => reason !== null) ?? null;

  const goBack = () => {
    if (step > 0) setStep(step - 1);
    else onBack();
  };
  useBackHandler(true, goBack);

  const handleSubmit = useCallback(async () => {
    if (firstBlockedStep !== -1) return;
    await submit(() => planGroup(defaultGroupLabel));
  }, [defaultGroupLabel, firstBlockedStep, planGroup, submit]);

  const footerRef = useRef<HTMLDivElement | null>(null);
  const lastStep = step === STEPS.length - 1;

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col pb-[env(safe-area-inset-bottom)] md:max-w-2xl">
      <ScreenHeader
        title={isEditing ? "Editar conta" : "Nova conta"}
        subtitle="Valor único"
        action={
          <Button variant="ghost" size="icon-lg" aria-label="Fechar" onClick={onBack}>
            <X className="size-5" />
          </Button>
        }
      />
      <WizardSteps steps={STEPS} current={step} />
      {conflictPanel && <div className="px-4 pt-2">{conflictPanel}</div>}

      {step === 0 && (
        <DetailsStep
          title={title}
          onTitleChange={(nextTitle) => store.updateExpense({ title: nextTitle })}
          occurredOn={store.occurredOn ?? todayIsoDate()}
          onOccurredOnChange={store.setOccurredOn}
          group={
            isDmMode
              ? null
              : {
                  value: groupSelection,
                  groups,
                  onSelect: handleGroupSelect,
                  createValue: createGroupName,
                  createFallback: createGroupFallback,
                  onCreateValueChange: setCreateGroupName,
                  createGroupEnabled,
                  onToggleCreateGroup: setCreateGroupEnabled,
                  dmEligible,
                }
          }
          participants={{
            me,
            participants: store.participants,
            guests: store.guests,
            selectedGroupId: selectedGroup?.group.id ?? null,
            groups,
            createGroup: { enabled: createGroupEnabled, name: createGroupName },
            onToggleCreateGroup: setCreateGroupEnabled,
            onCreateGroupName: setCreateGroupName,
            onSelectGroup: handleGroupSelect,
            onAddParticipant: (profile) => store.addParticipant(profileToUser(profile)),
            onRemoveParticipant: store.removeParticipant,
            onAddGuest: store.addGuest,
            onRemoveGuest: store.removeGuest,
            hasContactPicker,
            onPickContacts,
          }}
          note={
            inviteeNames.length > 0
              ? `${inviteeNames.join(", ")} ${inviteeNames.length > 1 ? "serão convidados" : "será convidado"} ao grupo.`
              : null
          }
          progress={startProgress}
          onProgressChange={setStartProgress}
          groupsPending={groupsPending}
        />
      )}

      {step === 1 && (
        <div className="space-y-4 px-4 py-3">
          <div className="space-y-2">
            <AmountField
              valueCents={totalCents}
              onChangeCents={(cents) => store.updateExpense({ totalAmountInput: cents, totalAmount: cents })}
              onValidityChange={setAmountValid}
              autoFocus={!isEditing && totalCents === 0}
            />
            <AmountQuickAdd
              valueCents={totalCents}
              onChangeCents={(cents) => store.updateExpense({ totalAmountInput: cents, totalAmount: cents })}
            />
          </div>
          <section aria-labelledby="single-consumption" className="space-y-1.5">
            <h2 id="single-consumption" className="px-1 text-xs font-semibold text-muted-foreground">
              Quem consumiu
            </h2>
            <SplitEditor
              label="Quem consumiu"
              people={splitPeople}
              mode={consumed.mode}
              onModeChange={consumption.setMode}
              included={consumed.included}
              onToggle={consumption.toggle}
              basisPointsById={consumed.percent.shares}
              centsById={consumedCents}
              onShareChange={consumption.setShare}
              onSplitEvenly={consumption.canSplitEvenly ? consumption.splitEvenly : null}
              emptyText="Escolha quem consumiu."
              shareVerb="consumiu"
              remainderCents={consumption.remainderCents}
            />
          </section>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 px-4 py-3">
          <p className="flex items-baseline justify-between gap-3 px-1 text-sm">
            <span className="text-muted-foreground">Total</span>
            <Money cents={totalCents} className="text-base" />
          </p>
          <section aria-labelledby="single-payers" className="space-y-1.5">
            <h2 id="single-payers" className="px-1 text-xs font-semibold text-muted-foreground">
              Quem pagou
            </h2>
            {store.guests.length > 0 && (
              <p className="px-1 text-xs text-muted-foreground">{GUEST_PAYER_NOTICE}</p>
            )}
            <SplitEditor
              label="Quem pagou"
              people={splitPeople.filter((person) => !person.isGuest)}
              mode={payers.draft.mode}
              onModeChange={payers.setMode}
              included={payers.draft.included}
              onToggle={payers.toggle}
              basisPointsById={payers.draft.percent.shares}
              centsById={payers.centsById}
              onShareChange={payers.setShare}
              onSplitEvenly={payers.canSplitEvenly ? payers.splitEvenly : null}
              emptyText="Escolha quem pagou."
              shareVerb="pagou"
              remainderCents={payers.remainderCents}
            />
          </section>
          <SplitSummary
            rows={splitPeople.map((person) => ({
              ...person,
              consumedCents: consumedCents[person.id] ?? 0,
              paidCents: payers.centsById[person.id] ?? 0,
            }))}
          />
        </div>
      )}

      <div ref={footerRef} className="mt-auto">
        {/* The start questions answer themselves; the footer waits for the people. */}
        {(step > 0 || startProgress.phase === "people") && (
          <WizardFooter
            onBack={step > 0 ? goBack : null}
            onContinue={() => {
              if (lastStep) void handleSubmit();
              else setStep(step + 1);
            }}
            continueLabel={lastStep ? (isEditing ? "Salvar alterações" : "Salvar conta") : "Continuar"}
            disabled={blocker !== null}
            reason={blocker}
            loading={submitting}
          />
        )}
      </div>
      <ScrollHint targetRef={footerRef} />
    </div>
  );
}
