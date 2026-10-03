"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RoomCodeEntry } from "@/components/assignment-room/room-code-entry";
import { canonicalizeRoomCode } from "@/lib/room-code";
import { resolveAssignmentRoomCode } from "@/lib/sync/assignment-room-codes";
import { ledgerErrorMessage } from "@/lib/sync/errors";

export function RoomCodeEntryPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(value: string) {
    if (canonicalizeRoomCode(value) === null) {
      setErrorMessage("Digite as duas palavras do código, tipo pipoca-moleza.");
      return;
    }
    setPending(true);
    setErrorMessage(null);
    try {
      const { roomId, grantToken } = await resolveAssignmentRoomCode(value);
      router.push(`/room/${roomId}#${grantToken}`);
    } catch (error) {
      setErrorMessage(ledgerErrorMessage(error));
      setPending(false);
    }
  }

  return (
    <RoomCodeEntry
      onSubmit={(code) => void handleSubmit(code)}
      pending={pending}
      errorMessage={errorMessage}
    />
  );
}
