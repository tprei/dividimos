"use client";

import { useCallback, useState } from "react";
import { confirmDraftExpense } from "@/lib/chat-draft-confirm";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";

export interface UseDraftConfirmReturn {
  confirmDraft: (result: ChatExpenseResult) => Promise<void>;
  isConfirming: boolean;
  error: string | null;
}

export function useDraftConfirm(
  groupId: string,
  counterpartyId: string,
  creatorId: string,
): UseDraftConfirmReturn {
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDraft = useCallback(
    async (result: ChatExpenseResult) => {
      setIsConfirming(true);
      setError(null);

      const outcome = await confirmDraftExpense({
        result,
        groupId,
        creatorId,
        counterpartyId,
      });

      setIsConfirming(false);

      if (!outcome.success) {
        setError(outcome.error);
      }
    },
    [groupId, creatorId, counterpartyId],
  );

  return { confirmDraft, isConfirming, error };
}
