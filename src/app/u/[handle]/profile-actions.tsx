"use client";

import { MessageCircle, Split } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { dmErrorMessage, getOrCreateDm } from "@/lib/sync/mutations-group";
import { useStartBillWithUser } from "@/components/profile/use-start-bill-with-user";
import { useAppStore } from "@/stores/app-store";

interface ProfileActionProps {
  targetUserId: string;
}

function useBlockedByMe(targetUserId: string): boolean {
  return useAppStore((s) => s.blockedUsers.some((user) => user.id === targetUserId));
}

export function SendMessageButton({ targetUserId }: ProfileActionProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const blocked = useBlockedByMe(targetUserId);

  const handleSendMessage = async () => {
    setLoading(true);
    try {
      await getOrCreateDm(targetUserId);
      router.push(`/app/conversations/${targetUserId}`);
    } catch (error) {
      toast.error(dmErrorMessage(error));
      setLoading(false);
    }
  };

  if (blocked) return null;

  return (
    <Button
      onClick={handleSendMessage}
      disabled={loading}
      variant="outline"
      className="w-full gap-2"
      size="lg"
    >
      <MessageCircle className="size-5" />
      {loading ? "Abrindo conversa..." : "Enviar mensagem"}
    </Button>
  );
}

export function SplitBillButton({ targetUserId }: ProfileActionProps) {
  const { startBill, starting } = useStartBillWithUser();
  const blocked = useBlockedByMe(targetUserId);

  if (blocked) return null;

  return (
    <Button
      onClick={() => void startBill(targetUserId)}
      disabled={starting}
      className="w-full gap-2"
      size="lg"
    >
      <Split className="size-5" />
      {starting ? "Abrindo conta..." : "Dividir uma conta"}
    </Button>
  );
}
