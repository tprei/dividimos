"use client";

import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import {
  acceptInvitation,
  declineInvitation,
} from "@/lib/sync/mutations-group";

export interface InvitationActions {
  accept: (groupId: string) => Promise<boolean>;
  decline: (groupId: string) => Promise<boolean>;
  pendingGroupId: string | null;
}

export function useInvitationActions(): InvitationActions {
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const accept = useCallback(async (groupId: string) => {
    setPendingGroupId(groupId);
    try {
      await acceptInvitation(groupId);
      toast.success("Convite aceito");
      return true;
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
      return false;
    } finally {
      setPendingGroupId(null);
    }
  }, []);

  const decline = useCallback(async (groupId: string) => {
    setPendingGroupId(groupId);
    try {
      await declineInvitation(groupId);
      toast.success("Convite recusado");
      return true;
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
      return false;
    } finally {
      setPendingGroupId(null);
    }
  }, []);

  return { accept, decline, pendingGroupId };
}
