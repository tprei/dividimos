"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";
import { createAssignmentRoom } from "@/lib/sync/assignment-rooms";
import { ledgerErrorMessage } from "@/lib/sync/errors";

interface AssignmentRoomHost {
  id: string;
  name: string;
}

interface UseAssignmentRoomEntryInput {
  host: AssignmentRoomHost | null;
  groupId: string | null;
}

export function useAssignmentRoomEntry({
  host,
  groupId,
}: UseAssignmentRoomEntryInput) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareReceipt = useCallback(
    async (result: ReceiptOcrResult, occurredOn: string) => {
      if (!host || pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setError(null);
      const title = result.merchant?.trim() || "Conta compartilhada";
      try {
        const view = await createAssignmentRoom({
          groupTarget: groupId
            ? { kind: "existing", groupId }
            : { kind: "new", name: title },
          header: {
            title,
            occurredOn,
            serviceFeeBasisPoints: result.serviceFeeBasisPoints,
            fixedFeeCents: result.fixedFeesCents,
          },
          items: result.items.map((item) => ({
            description: item.description,
            quantityMilliunits: item.quantity,
            unitPriceCents: item.unitPriceCents,
            totalPriceCents: item.totalCents,
          })),
          participants: [
            {
              id: crypto.randomUUID(),
              displayName: host.name,
              userId: host.id,
            },
          ],
        });
        // The nonsecret flag asks the room screen to present the invitation
        // dialog on arrival. It carries no access; the join token stays in
        // the URL fragment.
        router.push(`/room/${view.room.id}?invite=1`);
      } catch (cause) {
        setError(ledgerErrorMessage(cause));
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [groupId, host, router],
  );

  return { shareReceipt, pending, error };
}
