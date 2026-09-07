"use client";

import { createElement, useCallback, useState } from "react";
import toast from "react-hot-toast";
import { buildExpensePayload } from "@/lib/ledger/payload";
import { createExpense, editExpense } from "@/lib/sync/mutations";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { useBillStore } from "@/stores/bill-store";

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

export function useWizardSubmit({
  router,
  editExpenseId,
  expectedVersionNo,
  onStaleReload,
}: WizardSubmitInput) {
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (groupId: string | null): Promise<boolean> => {
      const state = useBillStore.getState();
      const occurredOn = state.occurredOn ?? todayIsoDate();
      const result = buildExpensePayload(state, occurredOn);
      if (!result.ok) {
        toast.error(payloadIssueMessage(result.issue));
        return false;
      }
      if (!editExpenseId && !groupId) {
        toast.error("Escolha um grupo para dividir a conta.");
        return false;
      }

      setSubmitting(true);
      try {
        const { header, payload } = result.value;
        if (editExpenseId) {
          await editExpense({
            expenseId: editExpenseId,
            expectedVersionNo: expectedVersionNo ?? 0,
            header,
            payload,
          });
          useBillStore.getState().reset();
          router.push(`/app/bill/${editExpenseId}`);
          return true;
        }
        const ack = await createExpense({ groupId: groupId ?? "", header, payload });
        useBillStore.getState().reset();
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
        setSubmitting(false);
      }
    },
    [router, editExpenseId, expectedVersionNo, onStaleReload],
  );

  return { submitting, submit };
}
