"use client";

import { useCallback, useState } from "react";
import {
  type ConfirmationPreferences,
  readConfirmationPreferences,
  updateConfirmationPreferences,
} from "@/lib/confirmation-preferences";

export function useConfirmationPreferences(
  userId: string,
): [ConfirmationPreferences, (patch: Partial<ConfirmationPreferences>) => void] {
  const [preferences, setPreferences] = useState<ConfirmationPreferences>(() =>
    readConfirmationPreferences(userId),
  );
  const [prevUserId, setPrevUserId] = useState(userId);

  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setPreferences(readConfirmationPreferences(userId));
  }

  const update = useCallback(
    (patch: Partial<ConfirmationPreferences>) => {
      const next = updateConfirmationPreferences(userId, patch);
      setPreferences(next);
    },
    [userId],
  );

  return [preferences, update];
}
