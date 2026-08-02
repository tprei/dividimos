"use client";

import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  issueGuestClaimToken,
  type IssueGuestClaimTokenResult,
} from "@/lib/supabase/expense-actions";

/**
 * Transient state for the open delivery modal. The plaintext token lives only
 * here for as long as the modal is open; closing clears it.
 */
export interface GuestClaimDeliveryModal {
  open: boolean;
  guestId: string;
  guestName: string;
  token: string | null;
  generation: number;
  expenseTitle: string;
  shareAmountCents?: number;
}

/**
 * A credential already exists for this guest. Confirming sends a rotate
 * (compare-and-set) with the recorded generation; PST08 drops back to the
 * non-rotating probe rather than retrying the rotate.
 */
export interface GuestClaimDeliveryRotatePrompt {
  guestId: string;
  guestName: string;
  generation: number;
  expenseTitle: string;
  shareAmountCents?: number;
}

export interface GuestClaimDelivery {
  modal: GuestClaimDeliveryModal;
  rotatePrompt: GuestClaimDeliveryRotatePrompt | null;
  issuing: boolean;
  /** Probe for a credential (rotate=false). Opens the modal on "issued" or
   *  prompts to rotate on "exists". */
  issue: (
    guestId: string,
    guestName: string,
    expenseTitle: string,
    shareAmountCents?: number,
  ) => Promise<void>;
  /** Confirm an "exists" prompt: rotate with the recorded generation. */
  confirmRotate: () => Promise<void>;
  /** Dismiss an "exists" prompt without an RPC call. */
  cancelRotate: () => void;
  /** Close the delivery modal and drop the transient token. */
  closeModal: () => void;
}

const CLOSED_MODAL: GuestClaimDeliveryModal = {
  open: false,
  guestId: "",
  guestName: "",
  token: null,
  generation: 0,
  expenseTitle: "",
};

/**
 * Creator-facing guest-credential delivery state machine. Centralizes the
 * issue/rotate compare-and-set flow so both delivery surfaces (the bill detail
 * page and the group detail view) share one correct copy of the logic.
 *
 * Invariants:
 *  - At most one mutation is in flight at a time (synchronous ref guard).
 *  - Each request is tagged with its guest id so an out-of-order response can
 *    never open the modal for the wrong guest.
 *  - A stale-generation rotate (PST08) re-probes with rotate=false instead of
 *    retrying the rotate.
 */
export function useGuestClaimDelivery(): GuestClaimDelivery {
  const [modal, setModal] = useState<GuestClaimDeliveryModal>(CLOSED_MODAL);
  const [rotatePrompt, setRotatePrompt] = useState<GuestClaimDeliveryRotatePrompt | null>(null);
  const [issuing, setIssuing] = useState(false);
  const inflightRef = useRef<string | null>(null);

  const closeModal = useCallback(() => {
    setModal((prev) => ({ ...prev, open: false, token: null }));
  }, []);

  const applyResult = useCallback(
    (
      guestId: string,
      guestName: string,
      expenseTitle: string,
      shareAmountCents: number | undefined,
      result: IssueGuestClaimTokenResult,
    ) => {
      if (result.outcome === "issued") {
        setModal({
          open: true,
          guestId,
          guestName,
          token: result.token,
          generation: result.generation,
          expenseTitle,
          shareAmountCents,
        });
        setRotatePrompt(null);
      } else {
        setRotatePrompt({
          guestId,
          guestName,
          generation: result.generation,
          expenseTitle,
          shareAmountCents,
        });
        setModal((prev) => ({ ...prev, open: false, token: null }));
      }
    },
    [],
  );

  const runIssue = useCallback(
    async (
      guestId: string,
      guestName: string,
      expenseTitle: string,
      shareAmountCents: number | undefined,
      rotate: boolean,
      expectedGeneration: number | null,
    ) => {
      if (inflightRef.current !== null) return;
      inflightRef.current = guestId;
      setIssuing(true);
      try {
        const res = await issueGuestClaimToken(guestId, rotate, expectedGeneration);
        if (inflightRef.current !== guestId) return; // superseded by a newer action
        if ("error" in res) {
          if (rotate && res.error.code === "PST08") {
            // Stale generation: drop back to the non-rotating probe for a fresh
            // generation instead of retrying the rotate.
            const probe = await issueGuestClaimToken(guestId, false, null);
            if (inflightRef.current !== guestId) return;
            if ("error" in probe) {
              toast.error(probe.error.message);
              return;
            }
            applyResult(guestId, guestName, expenseTitle, shareAmountCents, probe.data);
            return;
          }
          toast.error(res.error.message);
          return;
        }
        applyResult(guestId, guestName, expenseTitle, shareAmountCents, res.data);
      } finally {
        if (inflightRef.current === guestId) {
          inflightRef.current = null;
          setIssuing(false);
        }
      }
    },
    [applyResult],
  );

  const issue = useCallback(
    (
      guestId: string,
      guestName: string,
      expenseTitle: string,
      shareAmountCents?: number,
    ) => runIssue(guestId, guestName, expenseTitle, shareAmountCents, false, null),
    [runIssue],
  );

  const confirmRotate = useCallback(async () => {
    if (!rotatePrompt || inflightRef.current !== null) return;
    await runIssue(
      rotatePrompt.guestId,
      rotatePrompt.guestName,
      rotatePrompt.expenseTitle,
      rotatePrompt.shareAmountCents,
      true,
      rotatePrompt.generation,
    );
  }, [rotatePrompt, runIssue]);

  const cancelRotate = useCallback(() => {
    setRotatePrompt(null);
  }, []);

  return { modal, rotatePrompt, issuing, issue, confirmRotate, cancelRotate, closeModal };
}
