"use client";

import { useMemo } from "react";
import { useAppStore } from "@/stores/app-store";
import { useBillStore } from "@/stores/bill-store";

export function useInvitedUserIds(): ReadonlySet<string> {
  const groupId = useBillStore((state) => state.expense?.groupId);
  const members = useAppStore((state) =>
    groupId ? state.groups[groupId]?.members : undefined,
  );
  return useMemo(() => {
    const ids = new Set<string>();
    for (const member of members ?? []) {
      if (member.status === "invited") ids.add(member.userId);
    }
    return ids;
  }, [members]);
}
