"use client";

import { createElement, useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { buildExpensePayload } from "@/lib/ledger/payload";
import { createExpense, createExpenseWithGroup, editExpense } from "@/lib/sync/mutations";
import { getOrCreateDm, inviteMember } from "@/lib/sync/mutations-group";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { useAppStore } from "@/stores/app-store";
import type { GroupPlan } from "@/components/bill/single-bill/use-group-resolution";
import { useBillStore } from "@/stores/bill-store";
import type { User } from "@/types";
import { clearDraftIntent, readDraftIntent } from "@/lib/draft-intent";

async function inviteMissingMembers(groupId: string, participants: User[]): Promise<void> {
  const snapshot = useAppStore.getState().groups[groupId];
  if (!snapshot) return;
  const meId = useAppStore.getState().me?.id;
  const known = new Set(snapshot.members.map((member) => member.userId));
  for (const participant of participants) {
    if (participant.id === meId || known.has(participant.id)) continue;
    await inviteMember(groupId, participant.id);
  }
}

export function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function payloadIssueMessage(issue: { code: string }): string {
  if (issue.code === "share_total_mismatch") {
    return "A divisão não bate com o total da conta.";
  }
  if (issue.code === "payer_total_mismatch") {
    return "O pagamento não bate com o total da conta.";
  }
  if (issue.code === "incomplete_expense") {
    return "Preencha os dados da conta antes de concluir.";
  }
  return "Confira os valores da conta";
}
export interface WizardSubmitInput {
  router: { push: (url: string) => void };
  editExpenseId: string | null;
  expectedVersionNo: number | null;
  /** Re-fetches the detail and re-hydrates the wizard after a stale_version. */
  onStaleReload: () => Promise<void>;
}

export interface GroupPlanInput {
  meId: string | null;
  createGroupEnabled: boolean;
  createGroupName: string;
  defaultGroupName: string;
}

export async function planGroup(input: GroupPlanInput): Promise<GroupPlan> {
  const currentGroupId = useBillStore.getState().expense?.groupId;
  if (currentGroupId) return { kind: "existing", groupId: currentGroupId };
  if (!input.meId) return { kind: "invalid" };
  const state = useBillStore.getState();
  const otherParticipants = state.participants.filter((participant) => participant.id !== input.meId);
  const hasGuests = state.guests.length > 0;
  const needsGroup = otherParticipants.length > 0 || hasGuests;
  if (!needsGroup) return { kind: "none" };
  if (otherParticipants.length === 1 && !hasGuests) {
    try {
      const dm = await getOrCreateDm(otherParticipants[0].id);
      useBillStore.getState().updateExpense({ groupId: dm.groupId });
      return { kind: "existing", groupId: dm.groupId };
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
      return { kind: "invalid" };
    }
  }
  if (!input.createGroupEnabled) {
    toast.error("Escolha um grupo existente ou deixe \"Criar grupo\" marcado.");
    return { kind: "invalid" };
  }
  return {
    kind: "create",
    name: input.createGroupName.trim() || input.defaultGroupName || "Novo grupo",
    memberIds: otherParticipants.map((participant) => participant.id),
  };
}

export function useWizardSubmit({
  router,
  editExpenseId,
  expectedVersionNo,
  onStaleReload,
}: WizardSubmitInput) {
  const [submitting, setSubmitting] = useState(false);

  const inFlight = useRef(false);

  const submit = useCallback(
    async (planGroup: () => Promise<GroupPlan>): Promise<boolean> => {
      if (inFlight.current) return false;

      const state = useBillStore.getState();
      const occurredOn = state.occurredOn ?? todayIsoDate();
      const result = buildExpensePayload(state, occurredOn);
      if (!result.ok) {
        toast.error(payloadIssueMessage(result.issue));
        return false;
      }

      inFlight.current = true;
      setSubmitting(true);
      try {
        const { header, payload } = result.value;
        if (editExpenseId) {
          const intent = readDraftIntent();
          const fallbackVersion =
            intent?.kind === "edit" &&
            (intent.expenseId === state.expense?.id || intent.expenseId === editExpenseId)
              ? intent.expectedVersionNo
              : null;
          const versionNo = expectedVersionNo ?? fallbackVersion ?? 0;

          await editExpense({
            expenseId: editExpenseId,
            expectedVersionNo: versionNo,
            header,
            payload,
          });
          useBillStore.getState().reset();
          clearDraftIntent();
          router.push(`/app/bill/${editExpenseId}`);
          return true;
        }

        const plan = await planGroup();
        if (plan.kind === "invalid") return false;
        if (plan.kind === "none") {
          toast.error("Escolha um grupo para dividir a conta.");
          return false;
        }

        // A brand-new group is written together with the bill, so a failure
        // here cannot leave behind a group nobody asked for.
        let ack;
        if (plan.kind === "create") {
          ack = await createExpenseWithGroup({
            groupName: plan.name,
            memberIds: plan.memberIds,
            clientId: state.draftKey,
            header,
            payload,
          });
        } else {
          await inviteMissingMembers(plan.groupId, state.participants);
          ack = await createExpense({
            groupId: plan.groupId,
            clientId: state.draftKey,
            header,
            payload,
          });
        }

        useBillStore.getState().reset();
        clearDraftIntent();
        router.push(`/app/bill/${ack.expenseId ?? ""}`);
        return true;
      } catch (error) {
        if (error instanceof LedgerError && error.code === "stale_version") {
          toast.custom(
            (t) =>
              createElement(
                "div",
                {
                  className:
                    "flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg",
                },
                createElement(
                  "span",
                  { className: "flex-1" },
                  "Alguém editou essa conta enquanto você mexia. Recarregar?",
                ),
                createElement(
                  "button",
                  {
                    className:
                      "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground",
                    onClick: () => {
                      toast.dismiss(t.id);
                      void onStaleReload();
                    },
                  },
                  "Recarregar",
                ),
              ),
            { duration: 20000 },
          );
        } else {
          toast.error(ledgerErrorMessage(error));
        }
        return false;
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [router, editExpenseId, expectedVersionNo, onStaleReload],
  );

  return { submitting, submit };
}
