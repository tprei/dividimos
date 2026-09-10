"use client";

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import {
  acceptInvitation,
  declineInvitation,
} from "@/lib/sync/mutations-group";

export interface InvitationActions {
  accept: (groupId: string) => Promise<void>;
  decline: (groupId: string) => Promise<void>;
  pendingGroupId: string | null;
}

export function useInvitationActions(): InvitationActions {
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const accept = useCallback(async (groupId: string) => {
    setPendingGroupId(groupId);
    try {
      await acceptInvitation(groupId);
      toast.success("Convite aceito");
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
    } finally {
      setPendingGroupId(null);
    }
  }, []);

  const decline = useCallback(async (groupId: string) => {
    setPendingGroupId(groupId);
    try {
      await declineInvitation(groupId);
      toast.success("Convite recusado");
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
    } finally {
      setPendingGroupId(null);
    }
  }, []);

  return { accept, decline, pendingGroupId };
}
