"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { dmErrorMessage, getOrCreateDm } from "@/lib/sync/mutations-group";

export function useStartBillWithUser() {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  const startBill = useCallback(
    async (userId: string) => {
      if (starting) return;
      setStarting(true);
      try {
        const { groupId } = await getOrCreateDm(userId);
        router.push(`/app/bill/new?dm=${userId}&groupId=${groupId}&type=single_amount`);
      } catch (error) {
        toast.error(dmErrorMessage(error));
        setStarting(false);
      }
    },
    [router, starting],
  );

  const openConversation = useCallback(
    async (userId: string) => {
      if (starting) return;
      setStarting(true);
      try {
        await getOrCreateDm(userId);
        router.push(`/app/conversations/${userId}`);
      } catch (error) {
        toast.error(dmErrorMessage(error));
        setStarting(false);
      }
    },
    [router, starting],
  );

  return { startBill, openConversation, starting };
}
